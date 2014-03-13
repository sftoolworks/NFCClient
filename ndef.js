/*!
 * Copyright(c) 2014 SF Toolworks <info@sftoolworks.com>
 * MIT License (http://opensource.org/licenses/MIT)
 *
 * basic implementation of NDEF message, with 
 * support for URI, Text, and Android Application
 * records.
 *
 * also supports more user-friendly text (JSON)
 * representation.  for JSON, every record has a
 * type and then an arguments field; arguments 
 * will be  passed to type constructor for the type. 
 * viz:
 *
 * [
 *  { "type": "U", 
 *    "arguments": "http://www.some.thing"
 *  },
 *  { "type": "T",
 *    "arguments: "a text record"
 *  },
 *  { "type": "android.com:pkg",
 *    "arguments: "org.some.fake.package"
 *  }
 * ]
 *
 * removed NFC/Type4 tag stuff as it wasn't helpful.
 *
 */

/**
 * NDEF message type
 */
function Message()
{
	this.records = [];
};

/**
 * get message as binary.  essentially just the records concatenated
 * together.
 */
Message.prototype.getBytes = function()
{
	var bytes = [];
	for ( var i = 0; i < this.records.length; i++)
	{
		bytes = bytes.concat( this.records[i].getBytes( i == 0, i == this.records.length-1 ));
	}
	return bytes;
};

/**
 * get as (our simplified) JSON representation
 */
Message.prototype.getJSON = function()
{
	var list = [];
	for( var i in this.records )
	{
		list.push( this.records[i].getJSON());
	}
	return JSON.stringify( list );
};

/**
 * parse the simplified JSON representation
 */
Message.fromJSON = function( json )
{
	var msg = new Message();
	var list = JSON.parse( json );
	for( var i in list ) 
	{
		msg.records.push( Record.fromJSON( list[i] ));
	}
	return msg;
};

/**
 * string representation
 */
Message.prototype.toString = function()
{
	var str = "NDEF Message containing " 
		+ this.records.length + " message"
		+ ( this.records.length == 1 ? "" : "s" )
		+ "\n";
	for( var i in this.records )
	{
		str += (Number(i)+1) + ": " + this.records[i].toString();
	}
	return str;
};

/**
 * static parse method, from a byte string
 * FIXME: buffer type?
 */
Message.parse = function( data ){
	
	var msg = new Message();
	var offset = 0;
	var consumed = 0;

	msg.records = [];
	while (offset < data.length)
	{
		var rslt = Record.parse(data, offset);
		offset += rslt.consumed;
		msg.records.push( rslt.record );
	}

	return msg;
	
};

/**
 * NDEF record header type.  in a record, this
 * is represented as a bitfield
 */
function Header(){

	this.messageBegin = false;
	this.messageEnd = false;
	this.chunked = false;
	this.shortRecord = false;
	this.IDLength = false;
	this.TNF = 0x01;

	if( arguments.length > 0 ) this.fromByte( arguments[0] );
	
};

/**
 * static cast method, to byte
 */
Header.prototype.toByte = function(){
	var b = this.TNF;
	if (this.messageBegin) b |= 0x80;
	if (this.messageEnd) b |= 0x40;
	if (this.chunked) b |= 0x20;
	if (this.shortRecord) b |= 0x10;
	if (this.IDLength) b |= 0x08;
	return b;
};

/**
 * static cast method, from byte
 */
Header.prototype.fromByte = function(b){
	this.messageBegin= ( b & 0x80 ) ;
	this.messageEnd= ( b & 0x40 ) ;
	this.chunked= ( b & 0x20 ) ;
	this.shortRecord= ( b & 0x10 ) ;
	this.IDLength = (b & 0x08) ;
	this.TNF = ( b & (0x7));
};

/**
 * NDEF Record base type
 */
function Record()
{
	this.type = "";
	this.bytes = [];
	
	// default to well-known type
	this.TNF = 0x01;
};

/**
 * type name -> constructor map for subtypes.  @see Record.Extend
 */
Record.typeKeys = {};

/**
 * register a subtype.  maps the type name to the class constructor.  @see Record.Extend
 */
Record.registerType = function( cls )
{
	this.typeKeys[cls.prototype.type] = function(args){ return new cls( args ); };
};

/**
 * parse (simplified) JSON version of this record; essentially, just
 * call the constructor with the arguments field.
 */
Record.fromJSON = function( obj )
{
	var ctor = this.typeKeys[obj.type];
	if ( null == ctor || typeof( ctor ) == "undefined" )
	{
		throw "Type not found: " + obj.type;
	}
	return new this.typeKeys[obj.type]( obj.args );
};

/**
 * get binary version of the record
 */
Record.prototype.getBytes = function( first, last )
{
	var header = new Header();
	var bytes = [];
	header.messageBegin = first;
	header.messageEnd = last;
	header.TNF = this.TNF;

	var data = this.bytes;
	header.shortRecord = data.length < 0x100;

	// header and type length 

	bytes.push( header.toByte());
	bytes.push( this.type.length );    

	// record length: 1 or 2 bytes depending on length and SR

	if (header.shortRecord) bytes.push( data.length );
	else
	{
		bytes.push((data.length >> 24) & 0xff);
		bytes.push((data.length >> 16) & 0xff);
		bytes.push((data.length >> 8) & 0xff);
		bytes.push((data.length & 0xff));
	}

	// type 
	for( var i = 0; i< this.type.length; i++ ) bytes.push( this.type.charCodeAt( i ));

	// data
	bytes = bytes.concat(data);

	return bytes;

};

/**
 * get JSON version of the record
 */
Record.prototype.getJSON = function()
{
	return { type: this.type };
};

/**
 * static parse method from bytes (string)
 * FIXME: buffer type?
 */
Record.parse = function( data, offset )
{
	var ptr = offset;
	var header;
	var typeLen = 0;
	var recordLen = 0;
	var recordType = "";

	if (data.length - ptr < 4) throw ("Invalid NDEF record data");

	header = new Header( data[ptr++] );
	typeLen = data[ptr++];

	if (header.shortRecord) recordLen = data[ptr++];
	else
    {
		var len = [];
		len.push( data[ptr++] );
		len.push( data[ptr++]);
		len.push( data[ptr++]);
		len.push( data[ptr++]);
		recordLen = ((len[0] << 24) | (len[1] << 16) | (len[2] << 8) | len[3]);
	}

	for( var i = 0; i < typeLen; i++)
		recordType += String.fromCharCode(data[ptr++]);

	if( data.length - ptr < recordLen ) throw ( "Invalid NDEF record data (len " 
		+ recordLen + "/" + (data.length-ptr) + ")" );

	var recordData = data.slice( ptr, ptr + recordLen );
	var consumed = ptr - offset + recordLen;

	for( var type in this.typeKeys )
	{
		if( recordType == type ) 
		{
			return { consumed: consumed, record: this.typeKeys[type]( recordData ) };
		}
	}
	throw ("Unsupported record type: " + recordType);


};

/** 
 * sort of backwards inheritance mechanism, used so we can 
 * generate a list of record types by typename, for parsing.
 *
 * in order to support generic record creation from a byte
 * stream, the record prototype needs to be able to find the
 * type-specific constructor.  we map those to type values
 * by name. since we're calling this method for each subtype,
 * it also handles the traditional extension mechanism
 * via prototype.
 */
Record.extend = function( cls, type, tnf )
{
	cls.prototype = new Record();
	cls.prototype.type = type;
	if( typeof( tnf ) != "undefined" ) cls.prototype.TNF = tnf;	
	Record.registerType( cls );
}

/**
 * well-known type T (text), with language ID field.
 * FIXME: support alternate encodings
 */
function TextRecord( cdata )
{
	this.text = "";
	this.lang = "en";
		
	if( typeof( cdata ) == "string" ) this.reset( cdata );
	else if( typeof( cdata ) != "undefined" ) this.parse( cdata );
		
};
Record.extend( TextRecord, "T" );

/**
 * parse a text record from byte stream
 */
TextRecord.prototype.parse = function( data )
{
	this.bytes = [];
	this.bytes = this.bytes.concat( data );
	if (this.bytes.length < 3) this.bytes = [ 2, 'e'.charCodeAt(0), 'n'.charCodeAt(0) ];
	this.lang = String.fromCharCode( this.bytes[1] ) + String.fromCharCode( this.bytes[2] );
	this.text = "";
	for( var i = 3; i< this.bytes.length; i++ ) this.text += String.fromCharCode( this.bytes[i] );
};

/**
 * construct a text record from text
 * FIXME: language ID
 */
TextRecord.prototype.reset = function( text )
{
	this.text = text;
	this.bytes = [];
	this.bytes.push( this.lang.length );
	for( var i = 0; i< this.lang.length; i++ ) this.bytes.push( this.lang.charCodeAt( i ));
	for( var i = 0; i< this.text.length; i++ ) this.bytes.push( this.text.charCodeAt( i ));
};

/**
 * string representation
 */
TextRecord.prototype.toString = function()
{
	return "NDEF Text Record, length " + this.text.length + "\n"
		+ this.text + "\n"; 
};

/**
 * return JSON representation (for the JSON representation
 * of any type, it should be whatever needs to get passed to
 * the ctor to instantiate the type).
 */
TextRecord.prototype.getJSON = function()
{
	return { type: this.type, args: this.text };
};

/**
 * well-known type U (URI)
 */
function URIRecord( cdata )
{
	this.URI = "";
	if( typeof( cdata ) == "string" ) this.reset( cdata );
	else if( typeof( cdata ) != "undefined" ) this.parse( cdata );
		
};
Record.extend( URIRecord, "U" );

/**
 * create a URI record from URI
 */
URIRecord.prototype.reset = function(uri)
{
	this.URI = uri;
	this.bytes = [];
	var protocol = 0;
	var lc = uri.toLowerCase();
		
	// start by finding protocol abbreviation
	for( protocol = 1; protocol <= this.ProtocolList.length; protocol++ )
		if( lc.match( new RegExp( "^" + this.ProtocolList[protocol] ))) break;

	// now stuff this into a byte array
	if( protocol >= this.ProtocolList.length) protocol = 0;
	var remainder = uri.substr(this.ProtocolList[protocol].length);
	var ct = remainder.length;

	this.bytes[0] = protocol;
	for( var i = 0; i< remainder.length; i++ ) this.bytes.push( remainder.charCodeAt( i ));
};

/**
 * parse a text record from byte stream
 */
URIRecord.prototype.parse = function(data)
{
	this.URI = "";
	if (data.length < 1) return;
	var protocol = data[0];
	if (protocol >= this.ProtocolList.length) protocol = 0;
	this.URI = this.ProtocolList[protocol];

    if( data.length > 1 )
	{
        for (var i = 1; i < data.length; i++) {
            this.URI += String.fromCharCode(data[i]);
        }
	}
	
	this.bytes = [];
	this.bytes = this.bytes.concat( data );
};

/**
 * string representation
 */
URIRecord.prototype.toString = function()
{
	return "NDEF URI Record: " + this.URI + "\n";
}

/**
 * return JSON representation 
 */
URIRecord.prototype.getJSON = function()
{
	return { type: this.type, args: this.URI };
};

/** the official list of protocol prefixes.  no gopher? */
URIRecord.prototype.ProtocolList = [
	"",
	"http://www.",
	"https://www.",
	"http://",
	"https://",
	"tel:",
	"mailto:",
	"ftp://anonymous:anonymous@",
	"ftp://ftp.",
	"ftps://",
	"sftp://",
	"smb://",
	"nfs://",
	"ftp://",
	"dav://",
	"news:",
	"telnet://",
	"imap:",
	"rtsp://",
	"urn:",
	"pop:",
	"sip:",
	"sips:",
	"tftp:",
	"btspp://",
	"btl2cap://",
	"btgoep://",
	"tcpobex://",
	"irdaobex://",
	"file://",
	"urn:epc:id:",
	"urn:epc:tag:",
	"urn:epc:pat:",
	"urn:epc:raw:",
	"urn:epc:",
	"urn:nfc:"
	
];

/**
 * Android application record: type is slightly more
 * complicated as it's not well-known (TNF=0x04)
 */
function AndroidApplicationRecord( cdata )
{
	this.packageName = "";
	if( typeof( cdata ) == "string" ) this.reset( cdata );
	else if( typeof( cdata ) != "undefined" ) this.parse( cdata );

};
Record.extend( AndroidApplicationRecord, "android.com:pkg", 0x04 ); // note not well-known

/**
 * create record from byte stream
 */
AndroidApplicationRecord.prototype.parse = function( data )
{
	this.bytes = [];
	this.bytes = this.bytes.concat( data );
	this.packageName = "";
	for( var i = 0; i< data.length; i++ ) this.packageName += String.fromCharCode( data[i] );
};

/**
 * create record from an android package name
 */
AndroidApplicationRecord.prototype.reset = function( text )
{
	this.packageName = text;
	this.bytes = [];
	for( var i = 0; i< text.length; i++ ) this.bytes.push( text.charCodeAt(i) );
};

/**
 * string representation
 */
AndroidApplicationRecord.prototype.toString = function()
{
	return "NDEF Android Application Record: package name " + this.packageName+ "\n";
}

/**
 * return JSON representation 
 */
AndroidApplicationRecord.prototype.getJSON = function()
{
	return { type: this.type, args: this.packageName };
};

// module exports

if( typeof( exports ) != "undefined" )	
{
	exports.Message = Message;
	exports.Record = Record;
	exports.TextRecord = TextRecord;
	exports.URIRecord = URIRecord;
	exports.AndroidApplicationRecord = AndroidApplicationRecord;
}

