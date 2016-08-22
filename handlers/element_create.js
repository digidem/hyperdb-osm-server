var collect = require('collect-stream')
var osm2Obj = require('osm2json')

var errors = require('../lib/errors')
var isValidContentType = require('../lib/valid_content_type.js')

module.exports = function (req, res, api, params, next) {
  if (!isValidContentType(req)) {
    return next(new errors.UnsupportedContentType())
  }

  var r = req.pipe(osm2Obj({types: [params.type], coerceIds: false}))
  collect(r, function (err, ops) {
    if (err) return next(new errors.XmlParseError(err))
    if (!ops.length) return next(new errors.XmlMissingElement(params.type))

    // If multiple elements are provided only the first is created.
    // The rest is discarded (this behaviour differs from changeset creation).
    api.createElement(ops[0], function (err, id, node) {
      if (err) return next(err)
      res.setHeader('content-type', 'text/plain')
      res.end(id + '\n')
    })
  })
}
