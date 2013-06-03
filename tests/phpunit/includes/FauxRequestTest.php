<?php

class FauxRequestTest extends MediaWikiTestCase {

	function testGetSetHeader() {
		$value = 'test/test';

		$request = new FauxRequest();
		$request->setHeader( 'Content-Type', $value );

		$this->assertEquals( $request->getHeader( 'Content-Type' ), $value );
		$this->assertEquals( $request->getHeader( 'CONTENT-TYPE' ), $value );
		$this->assertEquals( $request->getHeader( 'content-type' ), $value );
	}
}
