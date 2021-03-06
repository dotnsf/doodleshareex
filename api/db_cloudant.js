//. db_cloudant.js
var express = require( 'express' ),
    multer = require( 'multer' ),
    bodyParser = require( 'body-parser' ),
    crypto = require( 'crypto' ),
    fs = require( 'fs' ),
    { CloudantV1 } = require( '@ibm-cloud/cloudant' ),
    uuidv1 = require( 'uuid/v1' ),
    api = express();

var settings = require( '../settings' );

var settings_db_username = 'DB_USERNAME' in process.env ? process.env.DB_USERNAME : settings.db_username; 
var settings_db_password = 'DB_PASSWORD' in process.env ? process.env.DB_PASSWORD : settings.db_password; 
var settings_db_url = 'DB_URL' in process.env ? process.env.DB_URL : settings.db_url; 
var settings_db_name = 'DB_NAME' in process.env ? process.env.DB_NAME : settings.db_name; 

var cloudant = null;
if( settings_db_username && settings_db_password && settings_db_url ){
  process.env['CLOUDANT_AUTH_TYPE'] = 'BASIC';
  process.env['CLOUDANT_USERNAME'] = settings_db_username;
  process.env['CLOUDANT_PASSWORD'] = settings_db_password;
  process.env['CLOUDANT_URL'] = settings_db_url;
  cloudant = CloudantV1.newInstance( { serviceName: 'CLOUDANT' } );
}


api.use( multer( { dest: '../tmp/' } ).single( 'image' ) );
api.use( bodyParser.urlencoded( { extended: true } ) );
api.use( bodyParser.json() );
api.use( express.Router() );

api.post( '/image', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( cloudant ){
    var imgpath = req.file.path;
    var imgtype = req.file.mimetype;
    //var imgsize = req.file.size;
    var ext = imgtype.split( "/" )[1];
    var imgfilename = req.file.filename;
    var filename = req.file.originalname;

    var image_id = uuidv1();
    var img = fs.readFileSync( imgpath );
    var img64 = new Buffer( img ).toString( 'base64' );

    var params = {
      _id: image_id,
      filename: filename,
      type: 'image',
      timestamp: ( new Date() ).getTime(),
      name: req.body.name,
      comment: req.body.comment,
      room: req.body.room,
      uuid: req.body.uuid,
      _attachments: {
        image: {
          content_type: imgtype,
          data: img64
        }
      }
    };
    cloudant.postDocument( { db: settings_db_name, document: params } ).then( function( result ){
      var p = JSON.stringify( { status: true, id: image_id, body: result }, null, 2 );
      res.write( p );
      res.end();
    }).catch( function( err ){
      console.log( err );
      var p = JSON.stringify( { status: false, error: err }, null, 2 );
      res.status( 400 );
      res.write( p );
      res.end();
    }).finally( function(){
      fs.unlink( imgpath, function( err ){} );
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
    res.end();
  }
});

api.get( '/image', function( req, res ){
  if( cloudant ){
    var id = req.query.id;
    cloudant.getDocument( { db: settings_db_name, docId: id, attachments: true } ).then( function( result0 ){
      var att = result0.result._attachments;
      var content_type = att.image.content_type;
      var data = att.image.data;
      var image = new Buffer( data, 'base64' );
      res.contentType( content_type );
      res.end( image, 'binary' );
    }).catch( function( err0 ){
      console.log( err0 );
      var p = JSON.stringify( { status: false, error: err0 }, null, 2 );
      res.status( 400 );
      res.write( p );
      res.end();
    });
  }else{
    res.contentType( 'application/json; charset=utf-8' );
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
    res.end();
  }
});

api.delete( '/image', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( cloudant ){
    var id = req.query.id;

    //. Cloudant ????????????
    cloudant.getDocument( { db: settings_db_name, docId: id } ).then( function( result0 ){
      var rev = result0._rev;
      cloudant.deleteDocument( { db: settings_db_name, docId: id, rev: rev } ).then( function( result ){
        res.write( JSON.stringify( { status: true, body: result } ) );
        res.end();
      }).catch( function( err ){
        console.log( err );
        var p = JSON.stringify( { status: false, error: err }, null, 2 );
        res.status( 400 );
        res.write( p );
        res.end();
      });
    }).catch( function( err0 ){
      console.log( err0 );
      var p = JSON.stringify( { status: false, error: err0 }, null, 2 );
      res.status( 400 );
      res.write( p );
      res.end();
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
    res.end();
  }
});


//. #11
api.readImages = async function( limit, offset, room ){
  return new Promise( async ( resolve, reject ) => {
    if( cloudant ){
      var selector = { type: { "$eq": "image" } };
      if( room ){
        selector = { room: { "$eq": room } };
      }
      cloudant.postFind( { db: settings_db_name, selector: selector, fields: [  "_id", "_rev", "name", "type", "comment", "timestamp", "room", "uuid" ] } ).then( function( result ){
        //console.log( JSON.stringify( result ) );
        //console.log( result.result.docs[0] );
        var total = result.result.docs.length;
        var images = [];
        result.result.docs.forEach( function( doc ){
          if( doc._id.indexOf( '_' ) !== 0 && doc.type && doc.type == 'image' ){
            images.push( doc );
          }
        });

        images.sort( sortByTimestamp );

        if( offset || limit ){
          if( offset + limit > total ){
            images = images.slice( offset );
          }else{
            images = images.slice( offset, offset + limit );
          }
        }

        resolve( { status: true, limit: limit, offset: offset, images: images } );
      }).catch( function( err0 ){
        console.log( err0 );
        resolve( { status: false, error: err0 } );
      });
    }else{
      resolve( { status: false, error: 'db is failed to initialize.' } );
    }
  });
}

api.get( '/images', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var limit = req.query.limit ? parseInt( req.query.limit ) : 0;
  var offset = req.query.offset ? parseInt( req.query.offset ) : 0;
  var room = req.query.room ? req.query.room : ''; //'default';

  var r = await api.readImages( limit, offset, room );
  if( !r.status ){
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: r.error } ) );
    res.end();
  }else{
    res.write( JSON.stringify( { status: true, limit: limit, offset: offset, images: r.images } ) );
    res.end();
  }
});

//. #11
api.readRoom = async function( id, basic_id, basic_password ){
  return new Promise( async ( resolve, reject ) => {
    if( cloudant ){
      //. Cloudant ????????????
      cloudant.getDocument( { db: settings_db_name, docId: id } ).then( function( result0 ){
        var room = result0;
    
        if( room ){
          if( !room.basic_id && !room.basic_password ){
            resolve( { status: true, room: room } );
          }else{
            if( room.basic_id == basic_id && room.basic_password == basic_password ){
              resolve( { status: true, room: room } );
            }else{
              resolve( { status: false, error: 'wrong credentials' } );
            }
          }
        }else{
          //. ????????? room ??????????????????????????????????????????????????????????????????

          //.   - [ ] ????????? room ??????????????????????????????????????????????????????
          //.         ?????????????????????????????????????????????????????????
          //room = ...
          //resolve( { status: true, room: room } );
          //.   - [ ] room ???????????????????????????????????????????????????????????????
          resolve( { status: true, room: null } );
          //.   - [ ] room ?????????????????????????????????????????????
          //resolve( { status: false, error: "not found." } );
        }
      }).catch( function( err0 ){
        //console.log( err0 );
        //resolve( { status: false, error: err0 } );
        resolve( { status: true, room: null, error: err0 } );
      });
    }else{
      resolve( { status: false, error: "db is not initialized." } );
    }
  });
}

api.post( '/room/:id', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( cloudant ){
    var id = req.params.id;
    var r = await api.readRoom( id );
    if( !r.status || r.room == null ){
      //. ????????? room ???????????????????????????????????????????????????????????????
      var uuid = req.body.uuid;
      var basic_id = req.body.basic_id;
      var basic_password = req.body.basic_password;
      var enc_basic_password = getHash( basic_password );
      var ts = ( new Date() ).getTime();

      var params = {
        _id: id,
        type: 'room',
        uuid: uuid,
        basic_id: basic_id,
        basic_password: enc_basic_password,
        created: ts,
        updated: ts
      };
      cloudant.postDocument( { db: settings_db_name, document: params } ).then( function( result ){
        var p = JSON.stringify( { status: true, id: id, body: result }, null, 2 );
        res.write( p );
        res.end();
      }).catch( function( err ){
        console.log( err );
        var p = JSON.stringify( { status: false, error: err }, null, 2 );
        res.status( 400 );
        res.write( p );
        res.end();
      });
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: 'room existed.' } ) );
      res.end();
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});

api.get( '/room/:id', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( cloudant ){
    var id = req.params.id;
    var uuid = req.body.uuid;
    var basic_id = req.body.basic_id;
    var basic_password = req.body.basic_password;
    var enc_basic_password = getHash( basic_password );
    var r = await api.readRoom( id, basic_id, enc_basic_password );
    if( r.status && r.room ){
      res.write( JSON.stringify( { status: true, room: r.room } ) );
      res.end();
    }else{
      if( r.error ){
        if( r.error == 'wrong credentials' ){
          res.write( JSON.stringify( { status: true, room: null, error: r.error } ) );
          res.end();
        }else{
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: r.error } ) );
          res.end();
        }
      }else{
        //. ???????????????????????????
        res.status( 400 );
        res.write( JSON.stringify( { status: false, error: "not existed." } ) );
        res.end();
      }
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});

api.put( '/room/:id', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( cloudant ){
    var id = req.params.id;
    var uuid = req.body.uuid;
    var basic_id = req.body.basic_id;
    var basic_password = req.body.basic_password;
    var enc_basic_password = getHash( basic_password );
    var r = await api.readRoom( id, basic_id, enc_basic_password  );
    if( r.status && r.room ){
      var new_basic_id = req.body.new_basic_id;
      var new_basic_password = req.body.new_basic_password;
      var enc_new_basic_password = getHash( new_basic_password );
      var ts = ( new Date() ).getTime();

      r.room.basic_id = new_basic_id;
      r.room.basic_password = enc_new_basic_password;
      r.room.updated = ts;

      cloudant.postDocument( { db: settings_db_name, document: r.room } ).then( function( result ){
        var p = JSON.stringify( { status: true, id: id, body: result }, null, 2 );
        res.write( p );
        res.end();
      }).catch( function( err ){
        console.log( err );
        var p = JSON.stringify( { status: false, error: err }, null, 2 );
        res.status( 400 );
        res.write( p );
        res.end();
      });
    }else{
      if( r.error ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, error: r.error } ) );
        res.end();
      }else{
        //. ???????????????????????????
        res.status( 400 );
        res.write( JSON.stringify( { status: false, error: "not existed." } ) );
        res.end();
      }
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});

api.delete( '/room/:id', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( cloudant ){
    var id = req.params.id;
    var uuid = req.body.uuid;
    var basic_id = req.body.basic_id;
    var basic_password = req.body.basic_password;
    var enc_basic_password = getHash( basic_password );
    var r = await api.readRoom( id, basic_id, enc_basic_password  );
    if( r.status && r.room ){
      var rev = r.room._rev;
      cloudant.deleteDocument( { db: settings_db_name, docId: id, rev: rev } ).then( function( result ){
        res.write( JSON.stringify( { status: true } ) );
        res.end();
      }).catch( function( err ){
        console.log( err );
        var p = JSON.stringify( { status: false, error: err }, null, 2 );
        res.status( 400 );
        res.write( p );
        res.end();
      });
    }else{
      if( r.error ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, error: r.error } ) );
        res.end();
      }else{
        //. ???????????????????????????
        res.status( 400 );
        res.write( JSON.stringify( { status: false, error: "not existed." } ) );
        res.end();
      }
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});

api.get( '/rooms', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var limit = req.query.limit ? parseInt( req.query.limit ) : 0;
  var offset = req.query.offset ? parseInt( req.query.offset ) : 0;
  var uuid = req.query.uuid ? req.query.uuid : '';

  if( cloudant && uuid ){
    var selector = { uuid: { "$eq": uuid } };
    cloudant.postFind( { db: settings_db_name, selector: selector, fields: [  "_id", "_rev", "name", "type", "comment", "timestamp", "room", "uuid" ] } ).then( function( result ){
      //console.log( JSON.stringify( result ) );
      //console.log( result.result.docs[0] );
      var total = result.result.docs.length;
      var rooms = [];
      result.result.docs.forEach( function( doc ){
        if( doc._id.indexOf( '_' ) !== 0 && doc.type && doc.type == 'room' ){
          rooms.push( doc );
        }
      });

      rooms.sort( sortByTimestamp );

      if( offset || limit ){
        if( offset + limit > total ){
          rooms = rooms.slice( offset );
        }else{
          rooms = rooms.slice( offset, offset + limit );
        }
      }

      var result = { status: true, uuid: uuid, total: total, limit: limit, offset: offset, rooms: rooms };
      res.write( JSON.stringify( result, 2, null ) );
      res.end();
    }).catch( function( err0 ){
      console.log( err0 );
      var p = JSON.stringify( { status: false, error: err0 }, null, 2 );
      res.status( 400 );
      res.write( p );
      res.end();
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});

function getHash( s ){
  if( s ){
    return crypto.createHash( 'sha1' ).update( s ).digest( 'hex' );
  }else{
    return '';
  }
}


function timestamp2datetime( ts ){
  if( ts ){
    var dt = new Date( ts );
    var yyyy = dt.getFullYear();
    var mm = dt.getMonth() + 1;
    var dd = dt.getDate();
    var hh = dt.getHours();
    var nn = dt.getMinutes();
    var ss = dt.getSeconds();
    var datetime = yyyy + '-' + ( mm < 10 ? '0' : '' ) + mm + '-' + ( dd < 10 ? '0' : '' ) + dd
      + ' ' + ( hh < 10 ? '0' : '' ) + hh + ':' + ( nn < 10 ? '0' : '' ) + nn + ':' + ( ss < 10 ? '0' : '' ) + ss;
    return datetime;
  }else{
    return "";
  }
}

function sortByTimestamp( a, b ){
  var r = 0;
  if( a.timestamp < b.timestamp ){
    r = -1;
  }else if( a.timestamp > b.timestamp ){
    r = 1;
  }

  return r;
}


//. api ?????????????????????
module.exports = api;
