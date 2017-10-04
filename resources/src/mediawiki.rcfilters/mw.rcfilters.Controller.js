( function ( mw, $ ) {
	/* eslint no-underscore-dangle: "off" */
	/**
	 * Controller for the filters in Recent Changes
	 * @class
	 *
	 * @constructor
	 * @param {mw.rcfilters.dm.FiltersViewModel} filtersModel Filters view model
	 * @param {mw.rcfilters.dm.ChangesListViewModel} changesListModel Changes list view model
	 * @param {mw.rcfilters.dm.SavedQueriesModel} savedQueriesModel Saved queries model
	 * @param {Object} config Additional configuration
	 * @cfg {string} savedQueriesPreferenceName Where to save the saved queries
	 */
	mw.rcfilters.Controller = function MwRcfiltersController( filtersModel, changesListModel, savedQueriesModel, config ) {
		this.filtersModel = filtersModel;
		this.changesListModel = changesListModel;
		this.savedQueriesModel = savedQueriesModel;
		this.savedQueriesPreferenceName = config.savedQueriesPreferenceName;

		this.requestCounter = {};
		this.baseFilterState = {};
		this.uriProcessor = null;
		this.initializing = false;
		this.wereSavedQueriesSaved = false;

		this.prevLoggedItems = [];

		this.FILTER_CHANGE = 'filterChange';
		this.SHOW_NEW_CHANGES = 'showNewChanges';
		this.LIVE_UPDATE = 'liveUpdate';
	};

	/* Initialization */
	OO.initClass( mw.rcfilters.Controller );

	/**
	 * Initialize the filter and parameter states
	 *
	 * @param {Array} filterStructure Filter definition and structure for the model
	 * @param {Object} [namespaceStructure] Namespace definition
	 * @param {Object} [tagList] Tag definition
	 */
	mw.rcfilters.Controller.prototype.initialize = function ( filterStructure, namespaceStructure, tagList ) {
		var parsedSavedQueries,
			displayConfig = mw.config.get( 'StructuredChangeFiltersDisplayConfig' ),
			controller = this,
			views = {},
			items = [],
			uri = new mw.Uri(),
			$changesList = $( '.mw-changeslist' ).first().contents();

		// Prepare views
		if ( namespaceStructure ) {
			items = [];
			$.each( namespaceStructure, function ( namespaceID, label ) {
				// Build and clean up the individual namespace items definition
				items.push( {
					name: namespaceID,
					label: label || mw.msg( 'blanknamespace' ),
					description: '',
					identifiers: [
						( namespaceID < 0 || namespaceID % 2 === 0 ) ?
							'subject' : 'talk'
					],
					cssClass: 'mw-changeslist-ns-' + namespaceID
				} );
			} );

			views.namespaces = {
				title: mw.msg( 'namespaces' ),
				trigger: ':',
				groups: [ {
					// Group definition (single group)
					name: 'namespace', // parameter name is singular
					type: 'string_options',
					title: mw.msg( 'namespaces' ),
					labelPrefixKey: { 'default': 'rcfilters-tag-prefix-namespace', inverted: 'rcfilters-tag-prefix-namespace-inverted' },
					separator: ';',
					fullCoverage: true,
					filters: items
				} ]
			};
		}
		if ( tagList ) {
			views.tags = {
				title: mw.msg( 'rcfilters-view-tags' ),
				trigger: '#',
				groups: [ {
					// Group definition (single group)
					name: 'tagfilter', // Parameter name
					type: 'string_options',
					title: 'rcfilters-view-tags', // Message key
					labelPrefixKey: 'rcfilters-tag-prefix-tags',
					separator: '|',
					fullCoverage: false,
					filters: tagList
				} ]
			};
		}

		// Add parameter range operations
		views.range = {
			groups: [
				{
					name: 'limit',
					type: 'single_option',
					title: '', // Because it's a hidden group, this title actually appears nowhere
					hidden: true,
					allowArbitrary: true,
					validate: $.isNumeric,
					range: {
						min: 0, // The server normalizes negative numbers to 0 results
						max: 1000
					},
					sortFunc: function ( a, b ) { return Number( a.name ) - Number( b.name ); },
					'default': displayConfig.limitDefault,
					// Temporarily making this not sticky until we resolve the problem
					// with the misleading preference. Note that if this is to be permanent
					// we should remove all sticky behavior methods completely
					// See T172156
					// isSticky: true,
					excludedFromSavedQueries: true,
					filters: displayConfig.limitArray.map( function ( num ) {
						return controller._createFilterDataFromNumber( num, num );
					} )
				},
				{
					name: 'days',
					type: 'single_option',
					title: '', // Because it's a hidden group, this title actually appears nowhere
					hidden: true,
					allowArbitrary: true,
					validate: $.isNumeric,
					range: {
						min: 0,
						max: displayConfig.maxDays
					},
					sortFunc: function ( a, b ) { return Number( a.name ) - Number( b.name ); },
					numToLabelFunc: function ( i ) {
						return Number( i ) < 1 ?
							( Number( i ) * 24 ).toFixed( 2 ) :
							Number( i );
					},
					'default': displayConfig.daysDefault,
					// Temporarily making this not sticky while limit is not sticky, see above
					// isSticky: true,
					excludedFromSavedQueries: true,
					filters: [
						// Hours (1, 2, 6, 12)
						0.04166, 0.0833, 0.25, 0.5
					// Days
					].concat( displayConfig.daysArray )
						.map( function ( num ) {
							return controller._createFilterDataFromNumber(
								num,
								// Convert fractions of days to number of hours for the labels
								num < 1 ? Math.round( num * 24 ) : num
							);
						} )
				}
			]
		};

		views.display = {
			groups: [
				{
					name: 'display',
					type: 'boolean',
					title: '', // Because it's a hidden group, this title actually appears nowhere
					hidden: true,
					isSticky: true,
					filters: [
						{
							name: 'enhanced',
							'default': String( mw.user.options.get( 'usenewrc', 0 ) )
						}
					]
				}
			]
		};

		// Before we do anything, we need to see if we require additional items in the
		// groups that have 'AllowArbitrary'. For the moment, those are only single_option
		// groups; if we ever expand it, this might need further generalization:
		$.each( views, function ( viewName, viewData ) {
			viewData.groups.forEach( function ( groupData ) {
				var extraValues = [];
				if ( groupData.allowArbitrary ) {
					// If the value in the URI isn't in the group, add it
					if ( uri.query[ groupData.name ] !== undefined ) {
						extraValues.push( uri.query[ groupData.name ] );
					}
					// If the default value isn't in the group, add it
					if ( groupData.default !== undefined ) {
						extraValues.push( String( groupData.default ) );
					}
					controller.addNumberValuesToGroup( groupData, extraValues );
				}
			} );
		} );

		// Initialize the model
		this.filtersModel.initializeFilters( filterStructure, views );

		this.uriProcessor = new mw.rcfilters.UriProcessor(
			this.filtersModel
		);

		if ( !mw.user.isAnon() ) {
			try {
				parsedSavedQueries = JSON.parse( mw.user.options.get( this.savedQueriesPreferenceName ) || '{}' );
			} catch ( err ) {
				parsedSavedQueries = {};
			}

			// Initialize saved queries
			this.savedQueriesModel.initialize( parsedSavedQueries );
			if ( this.savedQueriesModel.isConverted() ) {
				// Since we know we converted, we're going to re-save
				// the queries so they are now migrated to the new format
				this._saveSavedQueries();
			}
		}

		// Check whether we need to load defaults.
		// We do this by checking whether the current URI query
		// contains any parameters recognized by the system.
		// If it does, we load the given state.
		// If it doesn't, we have no values at all, and we assume
		// the user loads the base-page and we load defaults.
		// Defaults should only be applied on load (if necessary)
		// or on request
		this.initializing = true;
		if (
			!mw.user.isAnon() && this.savedQueriesModel.getDefault() &&
			!this.uriProcessor.doesQueryContainRecognizedParams( uri.query )
		) {
			// We have defaults from a saved query.
			// We will load them straight-forward (as if
			// they were clicked in the menu) so we trigger
			// a full ajax request and change of URL
			this.applySavedQuery( this.savedQueriesModel.getDefault() );
		} else {
			// There are either recognized parameters in the URL
			// or there are none, but there is also no default
			// saved query (so defaults are from the backend)
			// We want to update the state but not fetch results
			// again
			this.updateStateFromUrl( false );

			// Update the changes list with the existing data
			// so it gets processed
			this.changesListModel.update(
				$changesList.length ? $changesList : 'NO_RESULTS',
				$( 'fieldset.cloptions' ).first(),
				true // We're using existing DOM elements
			);
		}

		this.initializing = false;
		this.switchView( 'default' );

		this.pollingRate = mw.config.get( 'StructuredChangeFiltersLiveUpdatePollingRate' );
		if ( this.pollingRate ) {
			this._scheduleLiveUpdate();
		}
	};

	/**
	 * Create filter data from a number, for the filters that are numerical value
	 *
	 * @param {Number} num Number
	 * @param {Number} numForDisplay Number for the label
	 * @return {Object} Filter data
	 */
	mw.rcfilters.Controller.prototype._createFilterDataFromNumber = function ( num, numForDisplay ) {
		return {
			name: String( num ),
			label: mw.language.convertNumber( numForDisplay )
		};
	};

	/**
	 * Add an arbitrary values to groups that allow arbitrary values
	 *
	 * @param {Object} groupData Group data
	 * @param {string|string[]} arbitraryValues An array of arbitrary values to add to the group
	 */
	mw.rcfilters.Controller.prototype.addNumberValuesToGroup = function ( groupData, arbitraryValues ) {
		var controller = this,
			normalizeWithinRange = function ( range, val ) {
				if ( val < range.min ) {
					return range.min; // Min
				} else if ( val >= range.max ) {
					return range.max; // Max
				}
				return val;
			};

		arbitraryValues = Array.isArray( arbitraryValues ) ? arbitraryValues : [ arbitraryValues ];

		// Normalize the arbitrary values and the default value for a range
		if ( groupData.range ) {
			arbitraryValues = arbitraryValues.map( function ( val ) {
				return normalizeWithinRange( groupData.range, val );
			} );

			// Normalize the default, since that's user defined
			if ( groupData.default !== undefined ) {
				groupData.default = String( normalizeWithinRange( groupData.range, groupData.default ) );
			}
		}

		// This is only true for single_option group
		// We assume these are the only groups that will allow for
		// arbitrary, since it doesn't make any sense for the other
		// groups.
		arbitraryValues.forEach( function ( val ) {
			if (
				// If the group allows for arbitrary data
				groupData.allowArbitrary &&
				// and it is single_option (or string_options, but we
				// don't have cases of those yet, nor do we plan to)
				groupData.type === 'single_option' &&
				// and, if there is a validate method and it passes on
				// the data
				( !groupData.validate || groupData.validate( val ) ) &&
				// but if that value isn't already in the definition
				groupData.filters
					.map( function ( filterData ) {
						return String( filterData.name );
					} )
					.indexOf( String( val ) ) === -1
			) {
				// Add the filter information
				groupData.filters.push( controller._createFilterDataFromNumber(
					val,
					groupData.numToLabelFunc ?
						groupData.numToLabelFunc( val ) :
						val
				) );

				// If there's a sort function set up, re-sort the values
				if ( groupData.sortFunc ) {
					groupData.filters.sort( groupData.sortFunc );
				}
			}
		} );
	};

	/**
	 * Switch the view of the filters model
	 *
	 * @param {string} view Requested view
	 */
	mw.rcfilters.Controller.prototype.switchView = function ( view ) {
		this.filtersModel.switchView( view );
	};

	/**
	 * Reset to default filters
	 */
	mw.rcfilters.Controller.prototype.resetToDefaults = function () {
		this.uriProcessor.updateModelBasedOnQuery( this._getDefaultParams() );

		this.updateChangesList();
	};

	/**
	 * Check whether the default values of the filters are all false.
	 *
	 * @return {boolean} Defaults are all false
	 */
	mw.rcfilters.Controller.prototype.areDefaultsEmpty = function () {
		var defaultParams = this._getDefaultParams(),
			defaultFilters = this.filtersModel.getFiltersFromParameters( defaultParams );

		this._deleteExcludedValuesFromFilterState( defaultFilters );

		if ( Object.keys( defaultParams ).some( function ( paramName ) {
			return paramName.endsWith( '_color' ) && defaultParams[ paramName ] !== null;
		} ) ) {
			// There are highlights in the defaults, they're definitely
			// not empty
			return false;
		}

		// Defaults can change in a session, so we need to do this every time
		return Object.keys( defaultFilters ).every( function ( filterName ) {
			return !defaultFilters[ filterName ];
		} );
	};

	/**
	 * Empty all selected filters
	 */
	mw.rcfilters.Controller.prototype.emptyFilters = function () {
		var highlightedFilterNames = this.filtersModel
			.getHighlightedItems()
			.map( function ( filterItem ) { return { name: filterItem.getName() }; } );

		this.filtersModel.emptyAllFilters();
		this.filtersModel.clearAllHighlightColors();
		// Check all filter interactions
		this.filtersModel.reassessFilterInteractions();

		this.updateChangesList();

		if ( highlightedFilterNames ) {
			this._trackHighlight( 'clearAll', highlightedFilterNames );
		}
	};

	/**
	 * Update the selected state of a filter
	 *
	 * @param {string} filterName Filter name
	 * @param {boolean} [isSelected] Filter selected state
	 */
	mw.rcfilters.Controller.prototype.toggleFilterSelect = function ( filterName, isSelected ) {
		var filterItem = this.filtersModel.getItemByName( filterName );

		if ( !filterItem ) {
			// If no filter was found, break
			return;
		}

		isSelected = isSelected === undefined ? !filterItem.isSelected() : isSelected;

		if ( filterItem.isSelected() !== isSelected ) {
			this.filtersModel.toggleFilterSelected( filterName, isSelected );

			this.updateChangesList();

			// Check filter interactions
			this.filtersModel.reassessFilterInteractions( filterItem );
		}
	};

	/**
	 * Clear both highlight and selection of a filter
	 *
	 * @param {string} filterName Name of the filter item
	 */
	mw.rcfilters.Controller.prototype.clearFilter = function ( filterName ) {
		var filterItem = this.filtersModel.getItemByName( filterName ),
			isHighlighted = filterItem.isHighlighted();

		if ( filterItem.isSelected() || isHighlighted ) {
			this.filtersModel.clearHighlightColor( filterName );
			this.filtersModel.toggleFilterSelected( filterName, false );
			this.updateChangesList();
			this.filtersModel.reassessFilterInteractions( filterItem );

			// Log filter grouping
			this.trackFilterGroupings( 'removefilter' );
		}

		if ( isHighlighted ) {
			this._trackHighlight( 'clear', filterName );
		}
	};

	/**
	 * Toggle the highlight feature on and off
	 */
	mw.rcfilters.Controller.prototype.toggleHighlight = function () {
		this.filtersModel.toggleHighlight();
		this._updateURL();

		if ( this.filtersModel.isHighlightEnabled() ) {
			mw.hook( 'RcFilters.highlight.enable' ).fire();
		}
	};

	/**
	 * Toggle the namespaces inverted feature on and off
	 */
	mw.rcfilters.Controller.prototype.toggleInvertedNamespaces = function () {
		this.filtersModel.toggleInvertedNamespaces();

		if (
			this.filtersModel.getFiltersByView( 'namespaces' ).filter(
				function ( filterItem ) { return filterItem.isSelected(); }
			).length
		) {
			// Only re-fetch results if there are namespace items that are actually selected
			this.updateChangesList();
		}
	};

	/**
	 * Set the highlight color for a filter item
	 *
	 * @param {string} filterName Name of the filter item
	 * @param {string} color Selected color
	 */
	mw.rcfilters.Controller.prototype.setHighlightColor = function ( filterName, color ) {
		this.filtersModel.setHighlightColor( filterName, color );
		this._updateURL();
		this._trackHighlight( 'set', { name: filterName, color: color } );
	};

	/**
	 * Clear highlight for a filter item
	 *
	 * @param {string} filterName Name of the filter item
	 */
	mw.rcfilters.Controller.prototype.clearHighlightColor = function ( filterName ) {
		this.filtersModel.clearHighlightColor( filterName );
		this._updateURL();
		this._trackHighlight( 'clear', filterName );
	};

	/**
	 * Enable or disable live updates.
	 * @param {boolean} enable True to enable, false to disable
	 */
	mw.rcfilters.Controller.prototype.toggleLiveUpdate = function ( enable ) {
		this.changesListModel.toggleLiveUpdate( enable );
		if ( this.changesListModel.getLiveUpdate() && this.changesListModel.getNewChangesExist() ) {
			this.updateChangesList( null, this.LIVE_UPDATE );
		}
	};

	/**
	 * Set a timeout for the next live update.
	 * @private
	 */
	mw.rcfilters.Controller.prototype._scheduleLiveUpdate = function () {
		setTimeout( this._doLiveUpdate.bind( this ), this.pollingRate * 1000 );
	};

	/**
	 * Perform a live update.
	 * @private
	 */
	mw.rcfilters.Controller.prototype._doLiveUpdate = function () {
		if ( !this._shouldCheckForNewChanges() ) {
			// skip this turn and check back later
			this._scheduleLiveUpdate();
			return;
		}

		this._checkForNewChanges()
			.then( function ( newChanges ) {
				if ( !this._shouldCheckForNewChanges() ) {
					// by the time the response is received,
					// it may not be appropriate anymore
					return;
				}

				if ( newChanges ) {
					if ( this.changesListModel.getLiveUpdate() ) {
						return this.updateChangesList( null, this.LIVE_UPDATE );
					} else {
						this.changesListModel.setNewChangesExist( true );
					}
				}
			}.bind( this ) )
			.always( this._scheduleLiveUpdate.bind( this ) );
	};

	/**
	 * @return {boolean} It's appropriate to check for new changes now
	 * @private
	 */
	mw.rcfilters.Controller.prototype._shouldCheckForNewChanges = function () {
		return !document.hidden &&
			!this.filtersModel.hasConflict() &&
			!this.changesListModel.getNewChangesExist() &&
			!this.updatingChangesList &&
			this.changesListModel.getNextFrom();
	};

	/**
	 * Check if new changes, newer than those currently shown, are available
	 *
	 * @return {jQuery.Promise} Promise object that resolves with a bool
	 * 	specifying if there are new changes or not
	 *
	 * @private
	 */
	mw.rcfilters.Controller.prototype._checkForNewChanges = function () {
		var params = {
			limit: 1,
			peek: 1, // bypasses ChangesList specific UI
			from: this.changesListModel.getNextFrom()
		};
		return this._queryChangesList( 'liveUpdate', params ).then(
			function ( data ) {
				// no result is 204 with the 'peek' param
				return data.status === 200;
			}
		);
	};

	/**
	 * Show the new changes
	 *
	 * @return {jQuery.Promise} Promise object that resolves after
	 * fetching and showing the new changes
	 */
	mw.rcfilters.Controller.prototype.showNewChanges = function () {
		return this.updateChangesList( null, this.SHOW_NEW_CHANGES );
	};

	/**
	 * Save the current model state as a saved query
	 *
	 * @param {string} [label] Label of the saved query
	 * @param {boolean} [setAsDefault=false] This query should be set as the default
	 */
	mw.rcfilters.Controller.prototype.saveCurrentQuery = function ( label, setAsDefault ) {
		var highlightedItems = {},
			highlightEnabled = this.filtersModel.isHighlightEnabled(),
			selectedState = this.filtersModel.getSelectedState();

		// Prepare highlights
		this.filtersModel.getHighlightedItems().forEach( function ( item ) {
			highlightedItems[ item.getName() + '_color' ] = highlightEnabled ?
				item.getHighlightColor() : null;
		} );

		// Delete all excluded filters
		this._deleteExcludedValuesFromFilterState( selectedState );

		// Add item
		this.savedQueriesModel.addNewQuery(
			label || mw.msg( 'rcfilters-savedqueries-defaultlabel' ),
			{
				params: $.extend(
					true,
					{
						invert: String( Number( this.filtersModel.areNamespacesInverted() ) ),
						highlight: String( Number( this.filtersModel.isHighlightEnabled() ) )
					},
					this.filtersModel.getParametersFromFilters( selectedState )
				),
				highlights: highlightedItems
			},
			setAsDefault
		);

		// Save item
		this._saveSavedQueries();
	};

	/**
	 * Remove a saved query
	 *
	 * @param {string} queryID Query id
	 */
	mw.rcfilters.Controller.prototype.removeSavedQuery = function ( queryID ) {
		this.savedQueriesModel.removeQuery( queryID );

		this._saveSavedQueries();
	};

	/**
	 * Rename a saved query
	 *
	 * @param {string} queryID Query id
	 * @param {string} newLabel New label for the query
	 */
	mw.rcfilters.Controller.prototype.renameSavedQuery = function ( queryID, newLabel ) {
		var queryItem = this.savedQueriesModel.getItemByID( queryID );

		if ( queryItem ) {
			queryItem.updateLabel( newLabel );
		}
		this._saveSavedQueries();
	};

	/**
	 * Set a saved query as default
	 *
	 * @param {string} queryID Query Id. If null is given, default
	 *  query is reset.
	 */
	mw.rcfilters.Controller.prototype.setDefaultSavedQuery = function ( queryID ) {
		this.savedQueriesModel.setDefault( queryID );
		this._saveSavedQueries();
	};

	/**
	 * Load a saved query
	 *
	 * @param {string} queryID Query id
	 */
	mw.rcfilters.Controller.prototype.applySavedQuery = function ( queryID ) {
		var highlights,
			queryItem = this.savedQueriesModel.getItemByID( queryID ),
			data = this.savedQueriesModel.getItemFullData( queryID ),
			currentMatchingQuery = this.findQueryMatchingCurrentState();

		if (
			queryItem &&
			(
				// If there's already a query, don't reload it
				// if it's the same as the one that already exists
				!currentMatchingQuery ||
				currentMatchingQuery.getID() !== queryItem.getID()
			)
		) {
			highlights = data.highlights;

			// Update model state from filters
			this.filtersModel.toggleFiltersSelected(
				// Merge filters with excluded values
				$.extend(
					true,
					{},
					this.filtersModel.getFiltersFromParameters( data.params ),
					this.filtersModel.getExcludedFiltersState()
				)
			);

			// Update namespace inverted property
			this.filtersModel.toggleInvertedNamespaces( !!Number( data.params.invert ) );

			// Update highlight state
			this.filtersModel.toggleHighlight( !!Number( data.params.highlight ) );
			this.filtersModel.getItems().forEach( function ( filterItem ) {
				var color = highlights[ filterItem.getName() + '_color' ];
				if ( color ) {
					filterItem.setHighlightColor( color );
				} else {
					filterItem.clearHighlightColor();
				}
			} );

			// Check all filter interactions
			this.filtersModel.reassessFilterInteractions();

			this.updateChangesList();

			// Log filter grouping
			this.trackFilterGroupings( 'savedfilters' );
		}
	};

	/**
	 * Check whether the current filter and highlight state exists
	 * in the saved queries model.
	 *
	 * @return {boolean} Query exists
	 */
	mw.rcfilters.Controller.prototype.findQueryMatchingCurrentState = function () {
		var highlightedItems = {},
			selectedState = this.filtersModel.getSelectedState();

		// Prepare highlights of the current query
		this.filtersModel.getItemsSupportingHighlights().forEach( function ( item ) {
			highlightedItems[ item.getName() + '_color' ] = item.getHighlightColor();
		} );

		// Remove anything that should be excluded from the saved query
		// this includes sticky filters and filters marked with 'excludedFromSavedQueries'
		this._deleteExcludedValuesFromFilterState( selectedState );

		return this.savedQueriesModel.findMatchingQuery(
			{
				params: $.extend(
					true,
					{
						highlight: String( Number( this.filtersModel.isHighlightEnabled() ) ),
						invert: String( Number( this.filtersModel.areNamespacesInverted() ) )
					},
					this.filtersModel.getParametersFromFilters( selectedState )
				),
				highlights: highlightedItems
			}
		);
	};

	/**
	 * Delete sticky filters from given object
	 *
	 * @param {Object} filterState Filter state
	 */
	mw.rcfilters.Controller.prototype._deleteExcludedValuesFromFilterState = function ( filterState ) {
		// Remove excluded filters
		$.each( this.filtersModel.getExcludedFiltersState(), function ( filterName ) {
			delete filterState[ filterName ];
		} );
	};

	/**
	 * Save the current state of the saved queries model with all
	 * query item representation in the user settings.
	 */
	mw.rcfilters.Controller.prototype._saveSavedQueries = function () {
		var stringified, oldPrefValue,
			backupPrefName = this.savedQueriesPreferenceName + '-versionbackup',
			state = this.savedQueriesModel.getState();

		// Stringify state
		stringified = JSON.stringify( state );

		if ( $.byteLength( stringified ) > 65535 ) {
			// Sanity check, since the preference can only hold that.
			return;
		}

		if ( !this.wereSavedQueriesSaved && this.savedQueriesModel.isConverted() ) {
			// The queries were converted from the previous version
			// Keep the old string in the [prefname]-versionbackup
			oldPrefValue = mw.user.options.get( this.savedQueriesPreferenceName );

			// Save the old preference in the backup preference
			new mw.Api().saveOption( backupPrefName, oldPrefValue );
			// Update the preference for this session
			mw.user.options.set( backupPrefName, oldPrefValue );
		}

		// Save the preference
		new mw.Api().saveOption( this.savedQueriesPreferenceName, stringified );
		// Update the preference for this session
		mw.user.options.set( this.savedQueriesPreferenceName, stringified );

		// Tag as already saved so we don't do this again
		this.wereSavedQueriesSaved = true;
	};

	/**
	 * Update sticky preferences with current model state
	 */
	mw.rcfilters.Controller.prototype.updateStickyPreferences = function () {
		// Update default sticky values with selected, whether they came from
		// the initial defaults or from the URL value that is being normalized
		this.updateDaysDefault( this.filtersModel.getGroup( 'days' ).getSelectedItems()[ 0 ].getParamName() );
		this.updateLimitDefault( this.filtersModel.getGroup( 'limit' ).getSelectedItems()[ 0 ].getParamName() );

		// TODO: Make these automatic by having the model go over sticky
		// items and update their default values automatically
	};

	/**
	 * Update the limit default value
	 *
	 * param {number} newValue New value
	 */
	mw.rcfilters.Controller.prototype.updateLimitDefault = function ( /* newValue */ ) {
		// HACK: Temporarily remove this from being sticky
		// See T172156

		/*
		if ( !$.isNumeric( newValue ) ) {
			return;
		}

		newValue = Number( newValue );

		if ( mw.user.options.get( 'rcfilters-rclimit' ) !== newValue ) {
			// Save the preference
			new mw.Api().saveOption( 'rcfilters-rclimit', newValue );
			// Update the preference for this session
			mw.user.options.set( 'rcfilters-rclimit', newValue );
		}
		*/
		return;
	};

	/**
	 * Update the days default value
	 *
	 * param {number} newValue New value
	 */
	mw.rcfilters.Controller.prototype.updateDaysDefault = function ( /* newValue */ ) {
		// HACK: Temporarily remove this from being sticky
		// See T172156

		/*
		if ( !$.isNumeric( newValue ) ) {
			return;
		}

		newValue = Number( newValue );

		if ( mw.user.options.get( 'rcdays' ) !== newValue ) {
			// Save the preference
			new mw.Api().saveOption( 'rcdays', newValue );
			// Update the preference for this session
			mw.user.options.set( 'rcdays', newValue );
		}
		*/
		return;
	};

	/**
	 * Update the group by page default value
	 *
	 * @param {number} newValue New value
	 */
	mw.rcfilters.Controller.prototype.updateGroupByPageDefault = function ( newValue ) {
		if ( !$.isNumeric( newValue ) ) {
			return;
		}

		newValue = Number( newValue );

		if ( mw.user.options.get( 'usenewrc' ) !== newValue ) {
			// Save the preference
			new mw.Api().saveOption( 'usenewrc', newValue );
			// Update the preference for this session
			mw.user.options.set( 'usenewrc', newValue );
		}
	};

	/**
	 * Synchronize the URL with the current state of the filters
	 * without adding an history entry.
	 */
	mw.rcfilters.Controller.prototype.replaceUrl = function () {
		mw.rcfilters.UriProcessor.static.replaceState( this._getUpdatedUri() );
	};

	/**
	 * Update filter state (selection and highlighting) based
	 * on current URL values.
	 *
	 * @param {boolean} [fetchChangesList=true] Fetch new results into the changes
	 *  list based on the updated model.
	 */
	mw.rcfilters.Controller.prototype.updateStateFromUrl = function ( fetchChangesList ) {
		fetchChangesList = fetchChangesList === undefined ? true : !!fetchChangesList;

		this.uriProcessor.updateModelBasedOnQuery( new mw.Uri().query );

		// Update the sticky preferences, in case we received a value
		// from the URL
		this.updateStickyPreferences();

		// Only update and fetch new results if it is requested
		if ( fetchChangesList ) {
			this.updateChangesList();
		}
	};

	/**
	 * Update the list of changes and notify the model
	 *
	 * @param {Object} [params] Extra parameters to add to the API call
	 * @param {string} [updateMode='filterChange'] One of 'filterChange', 'liveUpdate', 'showNewChanges', 'markSeen'
	 * @return {jQuery.Promise} Promise that is resolved when the update is complete
	 */
	mw.rcfilters.Controller.prototype.updateChangesList = function ( params, updateMode ) {
		updateMode = updateMode === undefined ? this.FILTER_CHANGE : updateMode;

		if ( updateMode === this.FILTER_CHANGE ) {
			this._updateURL( params );
		}
		if ( updateMode === this.FILTER_CHANGE || updateMode === this.SHOW_NEW_CHANGES ) {
			this.changesListModel.invalidate();
		}
		this.changesListModel.setNewChangesExist( false );
		this.updatingChangesList = true;
		return this._fetchChangesList()
			.then(
				// Success
				function ( pieces ) {
					var $changesListContent = pieces.changes,
						$fieldset = pieces.fieldset;
					this.changesListModel.update(
						$changesListContent,
						$fieldset,
						false,
						// separator between old and new changes
						updateMode === this.SHOW_NEW_CHANGES || updateMode === this.LIVE_UPDATE
					);
				}.bind( this )
				// Do nothing for failure
			)
			.always( function () {
				this.updatingChangesList = false;
			}.bind( this ) );
	};

	/**
	 * Get an object representing the default parameter state, whether
	 * it is from the model defaults or from the saved queries.
	 *
	 * @return {Object} Default parameters
	 */
	mw.rcfilters.Controller.prototype._getDefaultParams = function () {
		var savedFilters,
			data = ( !mw.user.isAnon() && this.savedQueriesModel.getItemFullData( this.savedQueriesModel.getDefault() ) ) || {};

		if ( !$.isEmptyObject( data ) ) {
			// Merge saved filter state with sticky filter values
			savedFilters = $.extend(
				true, {},
				this.filtersModel.getFiltersFromParameters( data.params ),
				this.filtersModel.getStickyFiltersState()
			);

			// Return parameter representation
			return $.extend( true, {},
				this.filtersModel.getParametersFromFilters( savedFilters ),
				data.highlights,
				{ highlight: data.params.highlight, invert: data.params.invert }
			);
		}
		return this.filtersModel.getDefaultParams();
	};

	/**
	 * Update the URL of the page to reflect current filters
	 *
	 * This should not be called directly from outside the controller.
	 * If an action requires changing the URL, it should either use the
	 * highlighting actions below, or call #updateChangesList which does
	 * the uri corrections already.
	 *
	 * @param {Object} [params] Extra parameters to add to the API call
	 */
	mw.rcfilters.Controller.prototype._updateURL = function ( params ) {
		var currentUri = new mw.Uri(),
			updatedUri = this._getUpdatedUri();

		updatedUri.extend( params || {} );

		if (
			this.uriProcessor.getVersion( currentUri.query ) !== 2 ||
			this.uriProcessor.isNewState( currentUri.query, updatedUri.query )
		) {
			mw.rcfilters.UriProcessor.static.replaceState( updatedUri );
		}
	};

	/**
	 * Get an updated mw.Uri object based on the model state
	 *
	 * @return {mw.Uri} Updated Uri
	 */
	mw.rcfilters.Controller.prototype._getUpdatedUri = function () {
		var uri = new mw.Uri();

		// Minimize url
		uri.query = this.uriProcessor.minimizeQuery(
			$.extend(
				true,
				{},
				// We want to retain unrecognized params
				// The uri params from model will override
				// any recognized value in the current uri
				// query, retain unrecognized params, and
				// the result will then be minimized
				uri.query,
				this.uriProcessor.getUriParametersFromModel(),
				{ urlversion: '2' }
			)
		);

		return uri;
	};

	/**
	 * Query the list of changes from the server for the current filters
	 *
	 * @param {string} counterId Id for this request. To allow concurrent requests
	 *  not to invalidate each other.
	 * @param {Object} [params={}] Parameters to add to the query
	 *
	 * @return {jQuery.Promise} Promise object resolved with { content, status }
	 */
	mw.rcfilters.Controller.prototype._queryChangesList = function ( counterId, params ) {
		var uri = this._getUpdatedUri(),
			stickyParams = this.filtersModel.getStickyParams(),
			requestId,
			latestRequest;

		params = params || {};
		params.action = 'render'; // bypasses MW chrome

		uri.extend( params );

		this.requestCounter[ counterId ] = this.requestCounter[ counterId ] || 0;
		requestId = ++this.requestCounter[ counterId ];
		latestRequest = function () {
			return requestId === this.requestCounter[ counterId ];
		}.bind( this );

		// Sticky parameters override the URL params
		// this is to make sure that whether we represent
		// the sticky params in the URL or not (they may
		// be normalized out) the sticky parameters are
		// always being sent to the server with their
		// current/default values
		uri.extend( stickyParams );

		return $.ajax( uri.toString(), { contentType: 'html' } )
			.then(
				function ( content, message, jqXHR ) {
					if ( !latestRequest() ) {
						return $.Deferred().reject();
					}
					return {
						content: content,
						status: jqXHR.status
					};
				},
				// RC returns 404 when there is no results
				function ( jqXHR ) {
					if ( latestRequest() ) {
						return $.Deferred().resolve(
							{
								content: jqXHR.responseText,
								status: jqXHR.status
							}
						).promise();
					}
				}
			);
	};

	/**
	 * Fetch the list of changes from the server for the current filters
	 *
	 * @return {jQuery.Promise} Promise object that will resolve with the changes list
	 *  and the fieldset.
	 */
	mw.rcfilters.Controller.prototype._fetchChangesList = function () {
		return this._queryChangesList( 'updateChangesList' )
			.then(
				function ( data ) {
					var $parsed = $( '<div>' ).append( $( $.parseHTML( data.content ) ) ),
						pieces = {
							// Changes list
							changes: $parsed.find( '.mw-changeslist' ).first().contents(),
							// Fieldset
							fieldset: $parsed.find( 'fieldset.cloptions' ).first()
						};

					if ( pieces.changes.length === 0 ) {
						pieces.changes = 'NO_RESULTS';
					}

					return pieces;
				}
			);
	};

	/**
	 * Track usage of highlight feature
	 *
	 * @param {string} action
	 * @param {Array|Object|string} filters
	 */
	mw.rcfilters.Controller.prototype._trackHighlight = function ( action, filters ) {
		filters = typeof filters === 'string' ? { name: filters } : filters;
		filters = !Array.isArray( filters ) ? [ filters ] : filters;
		mw.track(
			'event.ChangesListHighlights',
			{
				action: action,
				filters: filters,
				userId: mw.user.getId()
			}
		);
	};

	/**
	 * Track filter grouping usage
	 *
	 * @param {string} action Action taken
	 */
	mw.rcfilters.Controller.prototype.trackFilterGroupings = function ( action ) {
		var controller = this,
			rightNow = new Date().getTime(),
			randomIdentifier = String( mw.user.sessionId() ) + String( rightNow ) + String( Math.random() ),
			// Get all current filters
			filters = this.filtersModel.getSelectedItems().map( function ( item ) {
				return item.getName();
			} );

		action = action || 'filtermenu';

		// Check if these filters were the ones we just logged previously
		// (Don't log the same grouping twice, in case the user opens/closes)
		// the menu without action, or with the same result
		if (
			// Only log if the two arrays are different in size
			filters.length !== this.prevLoggedItems.length ||
			// Or if any filters are not the same as the cached filters
			filters.some( function ( filterName ) {
				return controller.prevLoggedItems.indexOf( filterName ) === -1;
			} ) ||
			// Or if any cached filters are not the same as given filters
			this.prevLoggedItems.some( function ( filterName ) {
				return filters.indexOf( filterName ) === -1;
			} )
		) {
			filters.forEach( function ( filterName ) {
				mw.track(
					'event.ChangesListFilterGrouping',
					{
						action: action,
						groupIdentifier: randomIdentifier,
						filter: filterName,
						userId: mw.user.getId()
					}
				);
			} );

			// Cache the filter names
			this.prevLoggedItems = filters;
		}
	};

	/**
	 * Mark all changes as seen on Watchlist
	 */
	mw.rcfilters.Controller.prototype.markAllChangesAsSeen = function () {
		var api = new mw.Api();
		api.postWithToken( 'csrf', {
			formatversion: 2,
			action: 'setnotificationtimestamp',
			entirewatchlist: true
		} ).then( function () {
			this.updateChangesList( null, 'markSeen' );
		}.bind( this ) );
	};
}( mediaWiki, jQuery ) );
