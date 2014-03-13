/*!
 * Copyright(c) 2014 SF Toolworks <info@sftoolworks.com>
 * MIT License (http://opensource.org/licenses/MIT)
 *
 * sample communications library for our project board.
 *
 * events are emitted as type 'comms-event'.  the event
 * structure is an object, with properties
 *
 * type:	event type, from the COMMS_EVENT_TYPE enum
 * message:	optional text message
 * data:	optional data for binary messages
 * 
 * requires serialport, events, and NDEF library (local file,
 * not the npm package with that name).  
 */

var SerialPort = require("serialport"),
	NDEF = require("./ndef.js"),
	events = require("events");

// --- types -------------------------------------------------

/**
 * response codes from board
 */
var RESPONSE_CODE = 
{
    VERSION:	0xA0,
    ACK:		0xA1,
    DATA:		0xA2,
	
    INTERRUPT:	0xA4,
    MESSAGE:	0xA5,
    ERR:		0xEF,
	
    LAST: 0
};

/**
 * internal comms state, when processing inbound data
 */
var COMMS_STATE = 
{
    NULL:	0,
    LEN:	1,
    DATA:	2,
    INFO:	3,
    
    LAST: 0
};

/**
 * event types
 */
var COMMS_EVENT_TYPE = 
{
    NULL:			0,
    INFORMATION:	1,
    CONNECT_EVENT:	2,
    DATA:			4,
    ERROR:			8,
    NDEF_MESSAGE:	16,
    INTERRUPT:		32,
    ACK:			64,
    
    LAST: 0
};

/**
 * commands
 */
var COMMS_COMMAND = 
{
    // system commands

    NULL: 				0x00,
    VERSION: 			0x01,
    RF_ENABLE: 			0x02,
    RF_DISABLE: 		0x03,
    RESET_MESSAGE: 		0x04,
    BLINK: 				0x06,

    // mode commands

    START_USART_MODE: 	0x11,
    START_USB_MODE: 	0x12,
    USBSERIAL_MODE: 	0x13,

    USART_MODE_DEFAULT: 0x14,
    USB_MODE_DEFAULT: 	0x15,

    // read commands

    GET_NFC_MESSAGE: 	0x20,
    GET_NFC_MESSAGE_LENGTH: 0x21,

    GET_NVM_MESSAGE: 	0x22,
    GET_NVM_MESSAGE_LENGTH: 0x23,

    GET_RAM_MESSAGE: 	0x24,
    GET_RAM_MESSAGE_LENGTH: 0x25,

    // prefs

    READWRITE: 			0x30,
    READONLY: 			0x31,

    AUTO_RELOAD_MESSAGE_ON: 0x32,
    AUTO_RELOAD_MESSAGE_OFF: 0x33,

    AUTO_RF_ENABLE_ON: 	0x34,
    AUTO_RF_ENABLE_OFF: 0x35,

    TX_MESSAGE_ON_WRITE_ON: 0x36,
    TX_MESSAGE_ON_WRITE_OFF: 0x37,

    GET_USER_PREFS: 	0x3F,

    // write commands

    SET_NFC_MESSAGE: 	0x40,
    SET_NVM_MESSAGE: 	0x42,

    // special

    RESET_NFC: 			0x81,
    RESET_BOARD: 		0x82,

    MODE_CONFIRM_1: 	0x88,
    MODE_CONFIRM_2: 	0xAA,

    // filling out the enum

    LAST_VALUE: 0
};

// --- fields ------------------------------------------------

var port = null;
var state = COMMS_STATE.NULL;

var inbound = [];
var inboundCount = 0;
var inboundResponse = 0;

function Events(){}
Events.prototype = new events.EventEmitter();
var events = new Events();	

// --- methods -----------------------------------------------


/**
 * close serial port. 
 */ 
function disconnect()
{
    port.close();
};
	
/**
 * open serial port.  if you pass a port name, it will
 * use that port.  if not, it will attempt to locate the
 * board via the VID/PID or the bus description (the call
 * that serialport uses on different platforms returns
 * different information).
 *
 * @param use_port - override location, and just use the named port
 */
function connect( use_port )
{
	if( use_port )
	{
		connectport( use_port );
	}
	else
	{
		SerialPort.list(function (err, ports) {
			var pname = null;
			for( var i in ports )
			{
				if( ports[i].pnpId && 
					( ports[i].pnpId.match( /usb\-nfc/i )
					|| ports[i].pnpId.match( /VID_04D8\&PID_000A/i )))
				{
					pname = ports[i].comName;
				}
			}
			if (null == pname)
			{
				events.emit('comms-event', 
					{ message: "Port not found", type: COMMS_EVENT_TYPE.CONNECT_EVENT });
			}
			else connectport(pname);

		});
	}
};

/**
 * consume some inbound data and send an
 * event when you have a complete package
 * (message, ack, error, whatever).
 *
 * if there is debug output, separate from
 * any expected response, that will be
 * passed back via an information event.
 */
function processdata( data )
{
	var s = "";
	for( var i = 0; i< data.length; i++ )
	{
		var b = data[i];
		
		switch( state )
		{
		case COMMS_STATE.INFO:
		
			var evt = { data:b };
			if( inbound[0] == RESPONSE_CODE.ACK )
			{
				evt.type = COMMS_EVENT_TYPE.ACK;
			}
			else if( inbound[0] == RESPONSE_CODE.ERR )
			{
				evt.type = COMMS_EVENT_TYPE.ERROR;
			}	
			else if( inbound[0] == RESPONSE_CODE.INTERRUPT )
			{
				evt.type = COMMS_EVENT_TYPE.INTERRUPT;
			}
			state = COMMS_STATE.NULL;
			events.emit( 'comms-event', evt );
			break;
		
		case COMMS_STATE.LEN:
			inbound.push( b );
			if ( inbound.length == 2 )
			{
				inboundCount = ((inbound[0] << 8) | inbound[1]);
				inbound = [];
				state = COMMS_STATE.DATA;
			}
			break;

		case COMMS_STATE.DATA:
			inbound.push(b);
			if( inbound.length == inboundCount)
			{
				// reset state
				state = COMMS_STATE.NULL;
				
				if( inboundResponse == RESPONSE_CODE.MESSAGE )
				{
					// parse this message, then send it to listeners
					try
					{
						var msg = NDEF.Message.parse( inbound );
						events.emit( 'comms-event', { data: msg, type: COMMS_EVENT_TYPE.NDEF_MESSAGE });
					}
					catch( ex )
					{
						events.emit( 'comms-event', { message: "Message read error: " + ex, type: COMMS_EVENT_TYPE.ERROR });
					}
				}
				else if( inboundResponse == RESPONSE_CODE.DATA
						|| inboundResponse == RESPONSE_CODE.VERSION )
				{
					var arr = [];
					arr = arr.concat( inbound );
					events.emit( 'comms-event', 
						{ data: inbound, type: COMMS_EVENT_TYPE.DATA });
				}
				else throw( "Unexpected inbound response type: " + inboundResponse );
			}
			break;

		default:
			if( b == RESPONSE_CODE.MESSAGE )
			{
				state = COMMS_STATE.LEN;
				inbound = [];
				inboundCount = -1;
				inboundResponse = RESPONSE_CODE.MESSAGE;
			}
			else if( b == RESPONSE_CODE.DATA
					|| b == RESPONSE_CODE.VERSION )
			{
				inbound = [];
				state = COMMS_STATE.DATA;
				inboundCount = 2;
				inboundResponse = RESPONSE_CODE.DATA;
			}
			else if( b == RESPONSE_CODE.ACK 
						|| b == RESPONSE_CODE.ERR
						|| b == RESPONSE_CODE.INTERRUPT )
			{
				state = COMMS_STATE.INFO;
				inbound = [];
				inbound.push( b );
			}
			else
			{
				s += (b >= 0x20 && b <= 0x80) ? String.fromCharCode(b) : '?'; // hex(b) 
			}
			break;
		}
	}
	if( s.length )
	{
		events.emit( 'comms-event', 
			{ message: s, type: COMMS_EVENT_TYPE.INFORMATION });
	}
};

/**
 * send a command.  this method handles wrapping
 * up as a packet and escaping data. 
 */
function senddata( data )
{
	if ( null == port ) return;
	var bytes = [];

	// header
	bytes.push(0x4a);
    bytes.push(0xe5);

	// escape data
	for( var i = 0; i< data.length; i++ )
	{
		if (data[i] == 0x4a) bytes.push(0xe5);
		bytes.push(data[i]);
	}

	// write
	port.write( bytes );
	
};

/**
 * callback when the port is closed
 */
function portclosed() {

    port = null;
    events.emit('comms-event', 
        { message: "Closed", type: COMMS_EVENT_TYPE.CONNECT_EVENT });

};

/**
 * error callback
 */
function handleerror( e ) {

    events.emit('comms-event', 
        { message: e, type: COMMS_EVENT_TYPE.ERROR });

};

/**
 * internal connect method
 */
function connectport( path )
{
	// normally we would want to throw exceptions here,
	// but this is called via a callback so it's not practical
	
	if( null != port )
	{
		events.emit('comms-event', 
			{ message: "Already connected, call close", type: COMMS_EVENT_TYPE.CONNECT_EVENT });
		return;
	}

    try
	{
        port = new SerialPort.SerialPort(path, { baudrate: 19200 });
    }
    catch (ex)
	{
		events.emit('comms-event', 
			{ message: ex, type: COMMS_EVENT_TYPE.CONNECT_EVENT });
		return;
    }

	port.on( "open", function () { 
	    port.on('data', processdata);
	    port.on('err', handleerror);
	    port.on('close', portclosed );

	    events.emit('comms-event',
			{ message: "Connected", type: COMMS_EVENT_TYPE.CONNECT_EVENT });

	});
};	

if( typeof( exports ) != "undefined" )	
{
    exports.connect = connect;
    exports.disconnect = disconnect;
    exports.send = senddata;
    exports.events = events;
    exports.connected = function () { return (null != port); };

    exports.EVENT_TYPE = COMMS_EVENT_TYPE;
	exports.COMMAND = COMMS_COMMAND;
}


 
 
 
