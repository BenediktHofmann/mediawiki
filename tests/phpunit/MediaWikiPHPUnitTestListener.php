<?php

use PHPUnit\Framework\AssertionFailedError;
use PHPUnit\Framework\Test;
use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\TestListener;
use PHPUnit\Framework\TestListenerDefaultImplementation;
use PHPUnit\Framework\TestSuite;

class MediaWikiPHPUnitTestListener implements TestListener {
	use TestListenerDefaultImplementation;

	/**
	 * @var string
	 */
	protected $logChannel = 'PHPUnitCommand';

	/**
	 * @param Test $test
	 * @return string
	 */
	protected function getTestName( Test $test ) {
		$name = get_class( $test );

		if ( $test instanceof TestCase ) {
			$name .= '::' . $test->getName( true );
		}

		return $name;
	}

	protected function getErrorName( Exception $exception ) {
		$name = get_class( $exception );
		$name = "[$name] " . $exception->getMessage();

		return $name;
	}

	/**
	 * An error occurred.
	 *
	 * @param Test $test
	 * @param Exception $e
	 * @param float $time
	 */
	public function addError( Test $test, Exception $e, $time ) {
		wfDebugLog(
			$this->logChannel,
			'ERROR in ' . $this->getTestName( $test ) . ': ' . $this->getErrorName( $e )
		);
	}

	/**
	 * A failure occurred.
	 *
	 * @param Test $test
	 * @param AssertionFailedError $e
	 * @param float $time
	 */
	public function addFailure( Test $test, AssertionFailedError $e, $time ) {
		wfDebugLog(
			$this->logChannel,
			'FAILURE in ' . $this->getTestName( $test ) . ': ' . $this->getErrorName( $e )
		);
	}

	/**
	 * Incomplete test.
	 *
	 * @param Test $test
	 * @param Exception $e
	 * @param float $time
	 */
	public function addIncompleteTest( Test $test, Exception $e, $time ) {
		wfDebugLog(
			$this->logChannel,
			'Incomplete test ' . $this->getTestName( $test ) . ': ' . $this->getErrorName( $e )
		);
	}

	/**
	 * Skipped test.
	 *
	 * @param Test $test
	 * @param Exception $e
	 * @param float $time
	 */
	public function addSkippedTest( Test $test, Exception $e, $time ) {
		wfDebugLog(
			$this->logChannel,
			'Skipped test ' . $this->getTestName( $test ) . ': ' . $this->getErrorName( $e )
		);
	}

	/**
	 * A test suite started.
	 *
	 * @param TestSuite $suite
	 */
	public function startTestSuite( TestSuite $suite ) {
		wfDebugLog( $this->logChannel, 'START suite ' . $suite->getName() );
	}

	/**
	 * A test suite ended.
	 *
	 * @param TestSuite $suite
	 */
	public function endTestSuite( TestSuite $suite ) {
		wfDebugLog( $this->logChannel, 'END suite ' . $suite->getName() );
	}

	/**
	 * A test started.
	 *
	 * @param Test $test
	 */
	public function startTest( Test $test ) {
		Hooks::run( 'MediaWikiPHPUnitTest::startTest', [ $test ] );
		wfDebugLog( $this->logChannel, 'Start test ' . $this->getTestName( $test ) );
	}

	/**
	 * A test ended.
	 *
	 * @param Test $test
	 * @param float $time
	 */
	public function endTest( Test $test, $time ) {
		Hooks::run( 'MediaWikiPHPUnitTest::endTest', [ $test, $time ] );
		wfDebugLog( $this->logChannel, 'End test ' . $this->getTestName( $test ) );
	}
}
