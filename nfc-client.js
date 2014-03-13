/*!
 * Copyright(c) 2014 SF Toolworks <info@sftoolworks.com>
 * MIT License (http://opensource.org/licenses/MIT)
 *
 * simple client app for our project board.
 * 
 * requires serialport and NDEF library (local file,
 * not the npm package with that name).  
 */

var events = require('events'),
	repl = require("repl"),
	fs = require("fs"),
	NDEF = require("./ndef.js"),
	comms = require("./comms.js");

var force_port = false;
var interactive = false;
var initialized = false;

/** skeleton */
function verbose() {};

/**
 * send NDEF message to the board (directly
 * to the NFC transceiver, not writing to Flash)
 */
function sendMessage( message )
{
	if ( !comms.connected ) throw( "Not connected" );
	
	var bytes = message.getBytes( false );
	var len = bytes.length;
	
	// data is the command as one byte; the message
	// length as two bytes; then the message data
	
	var tmp = [ comms.COMMAND.SET_NFC_MESSAGE, len >> 8, len & 0xff ].concat( bytes );
	comms.send( tmp );
}

/**
 * this sample app automatically constructs
 * and sends a message to the board
 */
function initialize()
{
	initialized = true;
	
	// construct a message to send
	
	var message = new NDEF.Message();
	var user = process.env.USERNAME;
	if ( null == user || user.length == 0 ) user = process.env.USER;
	
	message.records.push( new NDEF.URIRecord(
		"http://sftoolworks.com/nfc/sample?text=Hello+from+" + user ));
	
	sendMessage( message );
	
}

/** utility method */
function hex(c) {
	
    var HEX = "0123456789ABCDEF";
	var str = "";
	while( c > 0 )
	{
		str = HEX[c%16] + str;
		c = Math.floor(c/16);
	}
	return (( str.length % 2 == 1 ) ? "0x0" : "0x" ) + str;

}

/**
 * event handler for events from the board
 * (via the comms lib).  events have a type,
 * which is in an enum in the comms object.
 *
 * @see the file comms.js
 */
comms.events.on( "comms-event", function( evt ){

	switch( evt.type )
    {
		// connect events are sent on any
		// port open/close or error
		
	    case comms.EVENT_TYPE.CONNECT_EVENT:
            console.log( evt.message )

			// on first connect, do some initialization
			
			if ( evt.message.match( /connected/i )) {
				if ( !initialized ) {
					initialize();
				}
			}
			
	        break;

		// ACKs are returned on any command
		// that does not have a defined response
			
	    case comms.EVENT_TYPE.ACK:
	        verbose("ACK " + hex( evt.data ));
	        break;

		// interrupts are sent when the tag is
		// read or, depending on configuration,
		// when the tag is written
			
	    case comms.EVENT_TYPE.INTERRUPT:
			if ( evt.data & 0x02 ) console.log( "Read interrupt" );
			if ( evt.data & 0x04 ) console.log( "Write interrupt" );
	        break;

		// data comes in response to requests
		// for message length, it is always
		// two bytes 
			
		case comms.EVENT_TYPE.DATA:
			console.log( "response: " + hex( evt.data[0] << 8 | evt.data[1] ));
			break;

		// an error occurred.  this could be a comms error or
		// an error from the board.  see
		// http://sftoolworks.com/nfc/reference.html#errorcodes
			
	    case comms.EVENT_TYPE.ERROR:
			if ( typeof( evt.message ) != "undefined" ) console.log( "error: " + evt.message );
			else console.log( "error: " + hex(evt.data) );
			break;
		
		// version is two bytes, returned in response
		// to a version command (0x01)
		
	    case comms.EVENT_TYPE.VERSION:
			console.log( "version: " + hex( evt.data[0] << 8 | evt.data[1] ));
			break;

		// if any data is recieved on the port that is not
		// part of a formatted message, it will be displayed
		// here.  that should not happen, except during dev/debug.
			
	    case comms.EVENT_TYPE.INFORMATION:
	        console.log("``" + evt.message + "''" );
	        break;

		// an NDEF message comes in already parsed via
		// the ndef library.  see the file ndef.js for the
		// structure of messages.
			
		case comms.EVENT_TYPE.NDEF_MESSAGE:
			console.log( evt.data.toString());
			break;
	};
		
});

/**
 * start an interactive session
 */
function startRepl()
{
	var R = repl.start({ prompt: ">" });

	R.context.COMMAND = comms.COMMAND;
	R.context.NDEF = NDEF;
	
	R.context.quit = R.context.exit = function(){ process.exit(0); };

	R.context.getMessage = function () {
		comms.send([comms.COMMAND.GET_NFC_MESSAGE]);
	}
	
	R.context.command = function (a) {
		comms.send([a]);
	}

	R.context.readMessage = function( path ) {
		var contents = fs.readFileSync( path, {encoding: "utf8"});
		var message = NDEF.Message.fromJSON( contents );
		return message;
	};

	R.context.saveMessage = function( message, path ) {
		var contents = message.getJSON();
		fs.writeFileSync( path, message, "utf8" );
	};
	
	R.context.sendMessage = function( obj ) {
		var message = obj;
		if ( typeof( obj ) == "string" )
		{
			var contents = fs.readFileSync( obj , {encoding: "utf8"});
			message = NDEF.Message.fromJSON( contents );
		}
		sendMessage( message );
	};

	R.context.help = function()
	{
		helpRepl();
	};
	
}

/**
 * info
 */
function helpRepl( )
{
	console.log()
	console.log( "Specific commands available:" );
	console.log()
	console.log( "command( value )         // send a command to the board" );
	console.log( "getMessage()             // retrieve the current message from the board" ); 
	console.log( "readMessage( path )      // read a mesage from a json file (see message.json)" ); 
	console.log( "sendMessage( var )       // send a message to the board" );
	console.log( "saveMessage( obj, path ) // save a message as a json file" );
	console.log();
	console.log( "for sendMessage(), pass either a message object or a path to a json file." );
	console.log( "you can construct a message using the NDEF object, or open a file using" );
	console.log( "readMessage()." );
	console.log();
	console.log( "for the command() function, use the enum object COMMAND - tab completion" );
	console.log( "shows available commands.  or just use numeric values from the docs." );
	console.log();
	console.log( "you can also use the NDEF object to create a message; try" );
	console.log();
	console.log( "> var m = new NDEF.Message();");
	console.log( "> m.records.push( new NDEF.URIRecord( \"http://google.com\" ));" );
	console.log( "> sendMessage(m);" );
	console.log();

}

/**
 * info
 */
function helpOption( )
{
	console.log();				
	console.log( "arguments:" );
	console.log();				
	console.log( "-?\t print this text and exit" );
	console.log( "-p name\t use the specified port name" );
	console.log( "-v\t print extra output/debug info" );
	console.log( "-i\t run interactive repl session" );
	console.log();				
	process.exit(0);
}

// handle arguments 
for( var i in process.argv )
{
	switch( process.argv[i].toLowerCase())
	{
		case '-?':
		case '--help':
			helpOption();
			break;
		
		case '-p':
		case '--port':
			force_port = process.argv[++i];
			break;

		case '-v':
		case '--verbose':
			verbose = function(msg){ console.log( msg ); };
			break;

		case '-i':
		case '--interactive':
			interactive = true;
			break;
	}
}

// start
comms.connect( force_port );
if ( interactive ) startRepl();

