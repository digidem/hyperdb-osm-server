var xtend = require('xtend')
var through = require('through2')
var readonly = require('read-only-stream')
var once = require('once')
var collect = require('collect-stream')

var errors = require('../errors')
var refs2nodes = require('../lib/util').refs2nodes

/**
 * Get the changes in a changeset, as `cb(err, changes)` or as a stream
 * @param  {string}   id  Changeset ID
 * @param  {Object}   osm hyperdb-osm instance
 * @param  {Function} cb  callback(err, array of elements from changeset)
 *                        Elements have the property 'action' which is one of
 *                        create|modify|delete
 * @returns {ReadableStream} Readable object stream of changes
 */
module.exports = function (osm) {
  return function getChanges (id, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    var stream = through.obj(getDoc)
    // Check whether doc with id exists
    osm.get(id, function (err, docs) {
      if (err) return onError(err)
      // Ensure that doc with id is of type changset
      if (!isChangeset(docs)) {
        return onError(new errors.NotFound('changeset id: ' + id))
      }
      // An object stream {key: versionId, value: 0}
      var r = osm.getChanges(id)
      r.on('error', onError)
      r.pipe(stream)
    })
    if (cb) {
      // If a callback is defined, collect the stream into an array
      cb = once(cb)
      collect(stream, cb)
    } else {
      // Otherwise return a readable stream
      return readonly(stream)
    }

    function getDoc (row, enc, next) {
      var self = this
      osm.getByVersion(row.version, function (err, element) {
        if (err) return next(err)
        getElementAction(osm, element, function (err, action) {
          if (err) return next(err)
          element.action = action
          self.push(refs2nodes(element))
          next()
        })
      })
    }

    function onError (err) {
      if (cb) return cb(err)
      stream.emit('error', err)
    }
  }
}

function isChangeset (docs) {
  var versions = Object.keys(docs)
  var result = false
  versions.forEach(function (version) {
    if (docs[version].type === 'changeset') result = true
  })
  return result
}

// HyperDB, OsmElement => String
function getElementAction (db, element, cb) {
  if (element.deleted) {
    return process.nextTick(cb, null, 'delete')
  }
  db.getPreviousHeads(element.version, function (err, elms) {
    if (err) return cb(err)
    if (elms.length > 0) cb(null, 'modify')
    else cb(null, 'create')
  })
}
