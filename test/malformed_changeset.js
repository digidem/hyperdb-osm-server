var test = require('tape')
var contentType = require('content-type')
var hyperquest = require('hyperquest')
var concat = require('concat-stream')

var base
var server

var createServer = require('./lib/test_server.js')

test('malformed_changeset.js: setup server', function (t) {
  createServer(function (d) {
    base = d.base
    server = d.server
    t.end()
  })
})

test('send malformed changeset upload', function (t) {
  t.plan(4)
  var href = base + 'changeset/create'
  var hq = hyperquest.put(href, {
    headers: { 'content-type': 'text/xml' }
  })
  hq.once('response', function (res) {
    t.notEqual(res.statusCode, 200, 'malformed xml error code')
    var contentObj = contentType.parse(res)
    t.equal(contentObj.type, 'text/plain', 'media type correct')
    t.equal(contentObj.parameters.charset.toLowerCase(), 'utf-8', 'charset correct')
  })
  hq.pipe(concat({ encoding: 'string' }, function (body) {
    t.notOk(/^[0-9A-Fa-f]+$/.test(body.trim()), 'not an id')
  }))
  hq.end(`<osm>
    <chongeset
      <tag k="comment" v="wow"/>
    /changeset>
  </osm>`)
})

test('malformed_changeset.js: teardown server', function (t) {
  server.cleanup(function () {
    t.end()
  })
})
