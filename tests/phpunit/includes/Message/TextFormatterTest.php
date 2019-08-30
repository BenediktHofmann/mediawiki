<?php

namespace MediaWiki\Tests\Message;

use MediaWiki\Message\TextFormatter;
use MediaWikiTestCase;
use Message;
use Wikimedia\Message\MessageValue;
use Wikimedia\Message\ParamType;
use Wikimedia\Message\TextParam;

/**
 * @covers \MediaWiki\Message\TextFormatter
 * @covers \Wikimedia\Message\MessageValue
 * @covers \Wikimedia\Message\ListParam
 * @covers \Wikimedia\Message\TextParam
 * @covers \Wikimedia\Message\MessageParam
 */
class TextFormatterTest extends MediaWikiTestCase {
	private function createTextFormatter( $langCode ) {
		return new class( $langCode ) extends TextFormatter {
			public function __construct( $langCode ) {
				parent::__construct( $langCode );
			}

			protected function createMessage( $key ) {
				return new FakeMessage( $key );
			}
		};
	}

	public function testGetLangCode() {
		$formatter = $this->createTextFormatter( 'fr' );
		$this->assertSame( 'fr', $formatter->getLangCode() );
	}

	public function testFormatBitrate() {
		$formatter = $this->createTextFormatter( 'en' );
		$mv = ( new MessageValue( 'test' ) )->bitrateParams( 100, 200 );
		$result = $formatter->format( $mv );
		$this->assertSame( 'test 100 bps 200 bps', $result );
	}

	public function testFormatList() {
		$formatter = $this->createTextFormatter( 'en' );
		$mv = ( new MessageValue( 'test' ) )->commaListParams( [
			'a',
			new TextParam( ParamType::BITRATE, 100 ),
		] );
		$result = $formatter->format( $mv );
		$this->assertSame( 'test a, 100 bps $2', $result );
	}
}

class FakeMessage extends Message {
	public function fetchMessage() {
		return "{$this->getKey()} $1 $2";
	}
}
