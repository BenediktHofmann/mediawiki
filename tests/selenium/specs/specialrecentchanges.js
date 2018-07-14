const assert = require( 'assert' ),
	EditPage = require( '../pageobjects/edit.page' ),
	RecentChangesPage = require( '../pageobjects/recentchanges.page' ),
	Util = require( 'wdio-mediawiki/Util' );

describe( 'Special:RecentChanges', function () {
	let content,
		name;

	beforeEach( function () {
		browser.deleteCookie();
		content = Util.getTestString();
		name = Util.getTestString();
	} );

	it( 'shows page creation', function () {
		EditPage.edit( name, content );

		RecentChangesPage.open();

		assert.strictEqual( RecentChangesPage.titles[ 0 ].getText(), name );
	} );

} );
