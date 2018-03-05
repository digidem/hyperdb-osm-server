var test = require('tape')
var http = require('http')
var url = require('url')
var concat = require('concat-stream')
var waterfall = require('run-waterfall')
var eos = require('end-of-stream')
var once = require('once')

var createServer = require('./lib/test_server.js')
var createOsm = require('./lib/test_db')
var slowdb = require('./lib/slowdb.js')

var DELAY = process.env.OSM_P2P_DB_DELAY

test('do not include points from an excluded way fork', function (t) {
  t.plan(10)

  var osmBase, osmForkA, osmForkB

  function setup (cb) {
    createOsm.createThree(function (a, b, c) {
      osmBase = a  // Has the base way
      osmForkA = b // Has a fork of the base way
      osmForkB = c // Has a different fork of the base way
      cb()
    })
  }

  var nodes = [
    {
      type: 'node',
      lon: 0,
      lat: -1
    },
    {
      type: 'node',
      lon: 0,
      lat: 0
    },
    {
      type: 'node',
      lon: 0,
      lat: 1
    }
  ]

  var wayId
  var wayVersionId
  var keyIds
  var forkARefs
  var forkAWayVersionId
  var forkBRefs
  var forkBWayVersionId
  var osmServer

  // Run the test steps
  waterfall([
    setup,
    step1,
    step2,
    step3,
    step4,
    step5,
    step6,
    step7,
    step8,
    step9
  ], function (err) {
    t.error(err)
  })

  // 1. Create base way
  function step1 (done) {
    createChangeset(osmBase, function (err, cs) {
      t.error(err)
      createNodes(osmBase, nodes, cs, function (err, keys) {
        keyIds = keys
        createWay(osmBase, keys, cs, function (err, way, wayVersion) {
          t.error(err)
          wayId = way
          wayVersionId = wayVersion
          done()
        })
      })
    })
  }

  // 2. Replicate base osm to fork A osm
  function step2 (done) {
    osmBase.ready(function () {
      sync(osmBase, osmForkA, function (err) {
        if (err) return done(err)
        osmForkA.ready(done)
      })
    })
  }

  // 3. Write modifications to fork A
  function step3 (done) {
    var node = {
      type: 'node',
      lon: 10,
      lat: 10
    }
    createChangeset(osmForkA, function (err, cs) {
      t.error(err)
      createNodes(osmForkA, [node], cs, function (err, keys) {
        var refs = keyIds.concat(keys)
        forkARefs = refs
        updateWay(osmForkA, wayId, wayVersionId, refs, cs, function (err, way) {
          t.error(err)
          forkAWayVersionId = way.version
          done()
        })
      })
    })
  }

  // 4. Replicate base osm to fork B osm
  function step4 (done) {
    sync(osmBase, osmForkB, function (err) {
      if (err) return done(err)
      osmForkB.ready(done)
    })
  }

  // 5. Write modifications to fork B
  function step5 (done) {
    var node = {
      type: 'node',
      lon: -10,
      lat: -10
    }
    createChangeset(osmForkB, function (err, cs) {
      t.error(err)
      createNodes(osmForkB, [node], cs, function (err, keys) {
        var refs = keyIds.concat(keys)
        forkBRefs = refs
        updateWay(osmForkB, wayId, wayVersionId, refs, cs, function (err, way) {
          forkBWayVersionId = way.version
          done(err)
        })
      })
    })
  }

  // 6. Replicate fork A and fork B
  function step6 (done) {
    sync(osmForkA, osmForkB, function (err) {
      if (err) return done(err)
      osmForkB.ready(done)
    })
  }

  // 7. Create an hyperdb-osm-server instance from fork A
  function step7 (done) {
    createServer(osmBase.db.key, function (d) {
      osmServer = d
      done()
    })
  }

  // 8. Replicate fork A and the server
  function step8 (done) {
    sync(osmServer.osm, osmForkA, function (err) {
      t.error(err)
      osmServer.osm.ready(done)
    })
  }

  // 9. Run an http query on the server to see which way & points are returned
  function step9 (done) {
    var opts = {
      hostname: 'localhost',
      port: url.parse(osmServer.base).port,
      path: '/api/0.6/map?bbox=-90,-90,90,90',
      headers: {
        'Accept': 'application/json'
      }
    }
    http.get(opts, function (res) {
      res.pipe(concat(function (json) {
        var data = JSON.parse(json)
        var nodeIds = data.elements
          .filter(function (elm) { return elm.type === 'node' })
          .map(function (elm) { return elm.id })
        var ways = data.elements.filter(function (elm) { return elm.type === 'way' })

        t.equal(ways.length, 1)

        // Ensure the way present matches one of the two possible forks and its nodes
        if (ways[0].version === forkAWayVersionId) {
          t.equal(ways[0].version, forkAWayVersionId)
          t.deepEqual(nodeIds.sort(), forkARefs.sort())
        } else if (ways[0].version === forkBWayVersionId) {
          t.equal(ways[0].version, forkBWayVersionId)
          t.deepEqual(nodeIds.sort(), forkBRefs.sort())
        } else {
          t.error('unexpected way version id')
        }

        osmServer.server.cleanup(done)
      }))
    })
  }
})

test('no extra points from forks /w 1 deleted node and 1 modified node', function (t) {
  t.plan(11)

  var nodes = [
    {
      type: 'node',
      lon: 0,
      lat: -1
    },
    {
      type: 'node',
      lon: 0,
      lat: 0
    },
    {
      type: 'node',
      lon: 0,
      lat: 1
    },
    {
      type: 'node',
      lon: 0,
      lat: 2
    }
  ]

  var wayId
  var wayVersionId
  var keyIds
  var forkBRefs
  var osmServer
  var osmBase, osmForkA, osmForkB

  function setup (cb) {
    createOsm.createThree(function (a, b, c) {
      osmBase = a  // Has the base way
      osmForkA = b // Has a fork of the base way
      osmForkB = c // Has a different fork of the base way
      cb()
    })
  }

  // Run the test steps
  waterfall([
    setup,
    step1,
    step2,
    step3,
    step4,
    step5,
    step6,
    step7,
    step8,
    step9
  ], function (err) {
    t.error(err)
  })

  // 1. Create base way
  function step1 (done) {
    createChangeset(osmBase, function (err, cs) {
      t.error(err)
      createNodes(osmBase, nodes, cs, function (err, keys) {
        keyIds = keys
        createWay(osmBase, keys, cs, function (err, way, wayVersion) {
          t.error(err)
          wayId = way
          wayVersionId = wayVersion
          done()
        })
      })
    })
  }

  // 2. Replicate base osm to fork A osm
  function step2 (done) {
    sync(osmBase, osmForkA, function (err) {
      if (err) return done(err)
      osmForkB.ready(done)
    })
  }

  // 3. Edit the 3rd point on fork A
  function step3 (done) {
    var node = {
      type: 'node',
      lon: 10,
      lat: 10
    }
    createChangeset(osmForkA, function (err, cs) {
      t.error(err)
      createNodes(osmForkA, [node], cs, function (err, keys) {
        var refs = keyIds.slice()
        refs[2] = keys[0]
        updateWay(osmForkA, wayId, wayVersionId, refs, cs, function (err, way) {
          t.error(err)
          done()
        })
      })
    })
  }

  // 4. Replicate base osm to fork B osm
  function step4 (done) {
    sync(osmBase, osmForkB, function (err) {
      if (err) return done(err)
      osmForkB.ready(done)
    })
  }

  // 5. Delete 3rd point on fork B
  function step5 (done) {
    createChangeset(osmForkB, function (err, cs) {
      t.error(err)
      deleteNode(osmForkB, keyIds[2], cs, function (err) {
        t.error(err)
        forkBRefs = [keyIds[0], keyIds[1], keyIds[3]]
        updateWay(osmForkB, wayId, wayVersionId, forkBRefs, cs, function (err, way) {
          done(err)
        })
      })
    })
  }

  // 6. Replicate fork A and fork B
  function step6 (done) {
    sync(osmForkA, osmForkB, function (err) {
      if (err) return done(err)
      osmForkB.ready(done)
    })
  }

  // 7. Create an hyperdb-osm-server instance
  function step7 (done) {
    createServer(osmBase.db.key, function (d) {
      osmServer = d
      done()
    })
  }

  // 8. Replicate fork A and the server
  function step8 (done) {
    sync(osmServer.osm, osmForkA, function (err) {
      t.error(err)
      osmServer.osm.ready(done)
    })
  }

  // 9. Run an http query on the server to see which way & points are returned
  function step9 (done) {
    function query (forks, done) {
      var opts = {
        hostname: 'localhost',
        port: url.parse(osmServer.base).port,
        path: '/api/0.6/map?bbox=-90,-90,90,90' + (forks ? '&forks=true' : ''),
        headers: {
          'Accept': 'application/json'
        }
      }
      http.get(opts, function (res) {
        res.pipe(concat(function (json) {
          done(null, json)
        }))
      })
    }

    query(false, function (_, json) {
      var data = JSON.parse(json)
      var nodeIds = data.elements
        .filter(function (elm) { return elm.type === 'node' })
        .map(function (elm) { return elm.id })
      var ways = data.elements.filter(function (elm) { return elm.type === 'way' })

      // TODO(noffle): Test for a failure, and if so, dump lots of debug
      // information so we can try and track down this bug
      // (https://github.com/digidem/osm-p2p-server/issues/28)
      if (nodeIds.length !== 3) {
        console.error('ERROR -- show @noffle this output!')
        query(true, function (_, json) {
          console.error(json.toString())
          osmServer.server.cleanup(done)
        })
      } else {
        // Ensure the way present matches the deleted fork, and the extra node
        // is not returned.
        t.equal(ways.length, 1)
        t.equal(nodeIds.length, 3)
        t.deepEqual(nodeIds.sort(), forkBRefs.sort())

        osmServer.server.cleanup(done)
      }
    })
  }
})

// creates a list of nodes
function createNodes (osm, nodes, changesetId, done) {
  var keys = []
  ;(function next () {
    var node = nodes.shift()
    if (!node) return done(null, keys)
    node.changeset = changesetId
    node.timestamp = (new Date()).toISOString()
    osm.create(node, function (err, elm) {
      if (err) return done(err)
      keys.push(elm.id)
      next()
    })
  })()
}

// deletes a node
function deleteNode (osm, nodeId, changesetId, done) {
  var op = {
    type: 'del',
    id: nodeId,
    value: { type: 'node', changeset: changesetId }
  }
  osm.batch([op], done)
}

// creates a changeset with a way and nodes
function createWay (osm, nodeIds, changesetId, done) {
  osm.create({
    type: 'way',
    refs: nodeIds,
    changeset: changesetId,
    timestamp: (new Date()).toISOString()
  }, function (err, elm) {
    if (err) done(err)
    else done(null, elm.id, elm.version)
  })
}

// updates a changeset with a way and nodes
function updateWay (osm, way, parentId, refs, changesetId, done) {
  osm.put(way, {
    type: 'way',
    refs: refs,
    changeset: changesetId,
    timestamp: (new Date()).toISOString()
  },
  // { links: [parentId] },
  function (err, way) {
    done(err, way)
  })
}

// create a new changeset
function createChangeset (osm, done) {
  osm.create({
    type: 'changeset'
  }, function (err, elm) {
    if (err) done(err)
    else done(null, elm.id, elm.version)
  })
}

function sync (db1, db2, done) {
  done = once(done)
  var r1 = db1.createReplicationStream()
  eos(r1, onEnd)

  var r2 = db2.createReplicationStream()
  eos(r2, onEnd)

  r1.pipe(r2).pipe(r1)

  var pending = 2
  function onEnd (err) {
    if (err) {
      return done(err)
    }
    if (--pending === 0) {
      return done()
    }
  }
}
