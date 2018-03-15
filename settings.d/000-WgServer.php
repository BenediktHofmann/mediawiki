<?php

$bsgWgServerFile = '/var/bluespice/data/wgServer';

$wgServer = '';

if( file_exists( $bsgWgServerFile ) ) {
	$wgServer = file_get_contents( $bsgWgServerFile );
}

if( isset( $_SERVER['SERVER_NAME'] ) ) {
	
        $protocol = $_SERVER['HTTP_REFERER'] == '' ? '' : explode( ':', $_SERVER['HTTP_REFERER'] )[0] . ':';
	$tmpServer = $protocol . '//' . $_SERVER['SERVER_NAME'];

	if( $tmpServer != $wgServer ) {
		file_put_contents( $bsgWgServerFile, $tmpServer );
		$wgServer = $tmpServer;
	}
}

