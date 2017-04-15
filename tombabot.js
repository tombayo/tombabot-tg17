function Bot(name,connectionInfo) {
  this.name = name;
  this.connection = connectionInfo;
  
  this.gametick = 0;
  this.ragetimer = 0;
  this.ragetime = 100;
  this.suddendeath = 600;
  
  this.botstate = 'normal';
  this.lastmove = '';
  
  // Tuning variables:
  this.searchTreshold = 70; // How many targets to trigger a radius search
  this.searchRadius = 6; // Initial search radius
  this.radiusIncrease = 8; // Search radius increment
  this.pelletWeight = 2; // The importance of pellets when pathfinding
  this.superPelletWeight = 5; // The importance of superpellets when pathfinding
  this.collisionRange = 8; // The range to avoid opponents at
  
  this.walkablemap = [];
  this.superpellets = [];
  this.pellets = [];
  
  this.PF  = require('pathfinding');
  this.PFfinder = new this.PF.BiBestFirstFinder();
  
  this.net = require('net');
  this.sock = new this.net.Socket();
  
  this.sortByArrayLengthDesc = function(a,b) { return a.length - b.length; }
  this.isWalkable = function(str) { return (str === '|') ? false:true; }
  this.isPellet = function(str) { return (str === '.') ? true:false; }
  this.isSuperPellet = function(str) { return (str === "o") ? true:false; }
  this.convertGrid = function(inputarray) {
    // Reset values
    this.walkablemap = [];
    this.superpellets = [];
    this.pellets = [];
    
    for (var i=0;i<inputarray.length;i++) { // every line in the input array (y)
      var row = inputarray[i];
      var walkablearr = [];
      
      for (var j=0;j<row.length;j++) { // Every char in line (x)
        var cell = row[j];
        
        var walkable = this.isWalkable(cell) ? 0 : 1;
        walkablearr.push(walkable);
        
        if(this.isSuperPellet(cell)) {
          this.superpellets.push({x:j,y:i});
        } else if (this.isPellet(cell)) {
          this.pellets.push({x:j,y:i});
        }
      }
      this.walkablemap.push(walkablearr);
    }
  }
  this.radiusSearch = function(from, targetlist, range, increment) {
    var newlist = [];
    for (var i=range;newlist.length==0;i+=increment) {
      newlist = targetlist.filter(function(target){
        if ((target.x > from.x-i) && (target.x < from.x+i) && (target.y > from.y-i) && (target.y < from.y+i)) {
          return true;
        } else {
          return false;
        }
      },from,i);
    }
    return newlist;
  }
  this.genPathList = function(from, items) {
    var pathlist = [];
    var grid = new this.PF.Grid(this.walkablemap);
    
    for (var i=0;i<items.length;i++) {
      var item = items[i];
      var path = this.PFfinder.findPath(from.x,from.y,item.x,item.y,grid.clone());
      if (path.length) { // Only push if path is found
        pathlist.push(path);
      }
      if (path.length == 2) { break; } // Item is on the next tile, no need to search anymore
    }
    
    return pathlist;
  }
  this.addMapAvoiders = function(from, items) {
    for (var i=0;i<items.length;i++) {
      var item = items[i];
      if (this.pathDistance(from, item) < this.collisionRange) {
        this.walkablemap[item.y][item.x] = 1;
      }
    }
  }
  this.pathDistance = function(from, to) {
    var path = this.genPathList(from, [to]);
    return (typeof path[0] === 'undefined') ? 0:path[0].length;
  }
  this.selectClosestTarget = function(from, targetlist) {
    var closest = {};
    var tmp = [];
    
    if (targetlist.length > this.searchTreshold) { 
      for(var i=this.searchRadius;i < this.walkablemap.length;i+=this.radiusIncrease) {
        tmp = this.genPathList(from, this.radiusSearch(from,targetlist,i,this.radiusIncrease));
        if (tmp.length > 0) {
          break;
        }
      }
    } else {
      tmp = this.genPathList(from, targetlist);
    }
    
    tmp.sort(this.sortByArrayLengthDesc);
    if (tmp.length) { // Checks if there's any targets left
      var selectedpath = tmp[0];
      var lastXY = tmp[0].pop();
      closest = {
        path:selectedpath,
        x:lastXY[0],
        y:lastXY[1]
      };
      return closest;
    } else {
      return false;
    }
  }
  this.move = function(pos, nextPos) {
    if (pos[0] == nextPos[0]) {
      return (pos[1] < nextPos[1]) ? 'DOWN' : 'UP';
    } else {
      return (pos[0] < nextPos[0]) ? 'RIGHT' : 'LEFT';
    }
  }
  this.scaleUp = function(gamestate) {
    var map = gamestate.map.content;
    var mapsizex = gamestate.map.width;
    var extrascale = Math.floor(mapsizex / 2);
    var walltile = "|";
    var newmap = [];

    for (var x=0;x<map.length;x++) {
      newmap.push(map[x].slice(-extrascale) + map[x] + map[x].slice(0,extrascale));
    }
    
    gamestate.map.content = newmap;
    
    for (var i=0;i<gamestate.others.length;i++) {
      gamestate.others[i].x += extrascale;
    }
    
    gamestate.you.x += extrascale;
    
    return gamestate;
  }
  this.getTargetOpponent = function(me, others) {
    return this.selectClosestTarget(me, others.filter(function(val){
      if (!val.isdangerous) {
        var pathlen = this.pathDistance(me, val); // Length from bot to opponent
        if (pathlen > this.ragetime - this.ragetimer) { // Can the bot reach him in time?
          return false;
        } else {
          return true;
        }
      } else {
        return false;
      }
    }.bind(this, me)));
  }
  this.getNeighbouringPellets = function(me, map) {
    var above = {x:me.x, y:me.y-1};
    var below = {x:me.x, y:me.y+1};
    var toleft = {x:me.x-1, y:me.y};
    var toright = {x:me.x+1, y:me.y};
    var posarr = [above, below, toleft, toright];
    var retarr = []
    
    for (var i=0;i<posarr.length;i++) {
      var p = posarr[i];
      if (typeof map[p.y][p.x] !== "undefined") {
        var cellchar = map[p.y][p.x];
        if (this.isPellet(cellchar)) {
          retarr.push({
            x:p.x,
            y:p.y,
            char:map[p.y][p.x],
            path:[p]
          });
        }
      }
    }
    return retarr;
  }
  this.getTargetSuperpellet = function(me, others) {
    this.addMapAvoiders(me, others); // Makes the pos of others non-walkable if close enough
    return this.selectClosestTarget(me, this.superpellets); // Selects the closest SuperPellet
  }
  this.getTargetPellet = function(me, others) {
    this.addMapAvoiders(me, others);
    var nextpellets = this.getNeighbouringPellets(me, this.rawmap);
    if (nextpellets.length) {
      return nextpellets[Math.floor((Math.random() * nextpellets.length))];
    } else {
      return this.selectClosestTarget(me, this.pellets);
    }
  }
  this.setBotstate = function(gamestate) {
    var numpellets = this.pellets.length;
    var numsuperpellets = this.superpellets.length;
    var isdangerous = gamestate.you.isdangerous;
    
    this.ragetimer = (isdangerous) ? this.ragetimer+1:0;
    
    if (isdangerous) {
      this.botstate = 'enraged';
    } else if (numsuperpellets > 0) {
      this.botstate = 'normal';
    } else if (numpellets > 0) {
      this.botstate = 'noSP';
    } else {
      this.botstate = 'EOR'; // End of Round
    }
    
  }
  this.evalMove = function(me, others) {
    var target = {};
    
    if (this.botstate === 'enraged') {
      target = this.getTargetOpponent(me, others);
      if (!target) {
        this.botstate = 'normal';
      }
    }
    if (this.botstate === 'normal') {
      target = this.getTargetSuperpellet(me, others);
      if (!target) {
        this.botstate = 'noSP';
      }
    }
    if (this.botstate === 'noSP') {
      target = this.getTargetPellet(me, others);
    }
    
    return this.targetsearch(me, target);
  }
  this.connect = function() {
    var ip = this.connection.ip;
    var port = this.connection.port;
    this.sock.connect(port, ip, this.greeting.bind(this));
    this.sock.on('data', this.dataHandler.bind(this));
    this.sock.on('close', function(){console.log('Connection Closed')});
  }
  this.greeting = function() {
    console.log('Connected to '+this.connection.ip+':'+this.connection.port);
    this.sock.write('NAME '+this.name+'\n');
  }
  this.dataHandler = function(data) {
    var json = {messagetype:'initalized'};
    
    try {
      json = JSON.parse(data.toString()); // Sometimes this fails due to fragmentation of data (i think)
    } catch(e) {} // Do nothing, we dont care, just wait for next tick
    
    if (json.messagetype === "stateupdate") {
      this.gametick++; // keeps track of the number of ticks the games been running for
      var gamestate = this.scaleUp(json.gamestate);
      
      var me = gamestate.you;
      var others = gamestate.others;
      this.rawmap = gamestate.map.content;
      this.convertGrid(this.rawmap); // Analyzes the map
      this.setBotstate(gamestate);
      
      var nextmove = this.evalMove(me,others);
      
      if (nextmove) {
        this.sock.write(nextmove+'\n'); // Sends our move to the server
        this.lastmove = nextmove; // Saves this move
      } else {
        this.sock.write(this.lastmove+'\n'); // Sends our last found move to the server
      }
    } else if (json.messagetype === 'startofround') {
      this.gametick = 0;
    }
  }
  this.targetsearch = function(source, target) {
    if (typeof target.path === 'undefined') {
      //console.log('Bad target given in targetsearch(): No move is returned.')
      return false;
    } else if (target.path.length > 1) {
      return this.move([source.x,source.y],target.path[1]);
    } else if (target.path.length === 1) {
      return this.move([source.x,source.y],[target.x,target.y]);
    } else {
      //console.log('Target path less than 1 in targetsearch(): No move is returned.');
      return false;
    }
  }
  
  this.connect(); //Starting the Bot
}

var myBot = new Bot('tombabot',{ip:process.argv[2],port:process.argv[3]});