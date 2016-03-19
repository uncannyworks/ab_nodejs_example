var sdk = require("armored_bits_nodejs_sdk");
var THREE = require("three");
var blessed = require("blessed");

var configure_mech = null;
var commit_configuration_finished = null;
var inGame = false;

var message_code_to_string = function(code) {
  for (var i in sdk.MESSAGE_CODES) {
    if (sdk.MESSAGE_CODES[i] == code) {
      return i;
    }
  }
}

// Begin UI
var screen = blessed.screen({
  smartCSR: true
});

screen.title = 'Armored Bits Example';

var stats = blessed.box({
  top: 'center',
  left: '0',
  width: '50%',
  height: '100%',
  content: '{bold}State{/bold}',
  tags: true,
  border: {
    type: 'line'
  },
  style: {
    fg: 'white',
    bg: 'magenta',
    border: {
      fg: '#f0f0f0'
    },
    hover: {
      bg: 'green'
    }
  }
});

var messages = blessed.box({
  top: 'center',
  left: '50%',
  width: '50%',
  height: '100%',
  content: '{bold}Messages Received{/bold}',
  tags: true,
  border: {
    type: 'line'
  },
  style: {
    fg: 'white',
    bg: 'magenta',
    border: {
      fg: '#f0f0f0'
    },
    hover: {
      bg: 'green'
    }
  }
});

screen.append(stats);
screen.append(messages);
messages.setLine(7, '{bold}Messages Sent{/bold}');

screen.key(['escape', 'q', 'C-c'], function(ch, key) {
  return process.exit(0);
});

screen.render();

// End UI

var receivedCounter = {};
var sentCounter = {};

var assign_hooks = function() {
  sdk.on_message_received = function(code, message) {
    if (receivedCounter[code]) receivedCounter[code]++;
    else
      receivedCounter[code] = 1;

    var i = 1;
    for (var p in receivedCounter) {
      messages.setLine(i++, receivedCounter[p] + " " + message_code_to_string(p));
    }

    screen.render();
  }

  sdk.on_message_sent = function(bytes) {
    if (sentCounter[bytes[0]]) sentCounter[bytes[0]]++;
    else
      sentCounter[bytes[0]] = 1;

    var i = 8;
    for (var p in sentCounter) {
      messages.setLine(i++, sentCounter[p] + " " + message_code_to_string(p));
    }

    screen.render();
  }

  sdk.on_connection_start = function() {
    stats.setLine(1, 'Connected... waiting for Configuration Phase Start.');
    screen.render();
  }

  sdk.on_connection_closed = function() {
    stats.setLine(1, 'Connection closed.');
    screen.render();
  }

  sdk.on_connection_timeout = function() {
    stats.setLine(1, 'Connection timeout.');
    screen.render();
    sdk.kill_connection();
  }

  sdk.on_connection_end = function() {
    stats.setLine(1, 'Connection end.');
    screen.render();
  }

  sdk.on_connection_error = function(err) {
    stats.setLine(1, "Connection Error: " + err.message);
    screen.render();
  }

  sdk.on_configuration_phase_start = function() {
    stats.setLine(1, "Configuration Phase Start...");
    screen.render();

    // TODO: Remove. This is for fast debugging.
    //sdk.use_default_configuration();
    //return;

    // Torso
    // Our torso model supports 1 weapon.
    var weaponsArray = [];
    weaponsArray.push(sdk.make_weapon("Weapon Type A", "", "Projectile Type A"));
    var torso_message = sdk.build_config_torso_message("Torso Type A", "TE003", "Armor Type A", weaponsArray, ["Counter Measure Type A"], "Actuator Type A");

    // Cockpit
    var cockpit_message = sdk.build_config_cockpit_message("Cockpit Type A", ["Computer Type A"], ["Sensor Type A"], ["Communication Type A"], "Armor Type A", ["Counter Measure Type A"]);

    // Arms
    var armsArray = [];
    for (var i = 0; i < 2; i++) { // Our chassis model only has 2 arms.
      // Our arms support 1 weapons each.
      var armWeaponsArray = [];
      armWeaponsArray.push(sdk.make_weapon("Weapon Type A", "", "Projectile Type A"));
      armsArray.push(sdk.make_arm("Arm Type A", "Armor Type A", armWeaponsArray, ["Counter Measure Type A"], i + 1));
    }
    var arm_messages = sdk.build_config_arm_messages(armsArray);

    // Legs
    var legsArray = [];
    for (var i = 0; i < 2; i++) { // Our chassis model only has 2 legs.      
      legsArray.push(sdk.make_leg("Leg Type A", "Armor Type A", i + 1));
    }
    var leg_messages = sdk.build_config_leg_messages(legsArray);

    // Full Request
    var config_message = this.build_config_mech_request("Mech Type A", "Capacitor Type A", "Gyro Type A", "KYR011", torso_message, cockpit_message, arm_messages, leg_messages);

    sdk.commit_configuration(config_message);
  }

  sdk.on_configuration_commit_finished = function(responseCode, errorCode, errorString) {
    if (errorCode == sdk.ERROR_CODES.NONE) {
      sdk.configuration_complete(); // Tell the SDK to let the game server know we're done.
    } else {
      messages.insertLine(1, "Error: " + errorString + " (" + errorCode + ")");
      screen.render();
      sdk.use_default_configuration(); // There were errors, lets just use the default rather than risk starting with a broken War Machine.
    }
  }

  sdk.on_configuration_phase_end = function() {
    stats.setLine(1, "Configuration Phase Ended");
    screen.render();
  }

  sdk.on_startup_phase_start = function() {
    stats.setLine(1, "Startup Phase Start");
    screen.render();
  }

  sdk.on_startup_phase_end = function() {
    stats.setLine(1, "Startup Phase End");
    screen.render();
  }

  sdk.on_game_phase_start = function() {
    stats.setLine(1, "Game Phase Start");
    screen.render();
    inGame = true;
    vt = process.hrtime();

    sdk.set_speed(20);

    query_wm();    
  }

  sdk.on_game_phase_end = function() {
    stats.setLine(1, "Game Phase End");
    screen.render();
    inGame = false;
  }
}

var vt;
var lastPos;
var lastTargetId = -1;

var qt;
var query_wm = function() {
  if (inGame) {
    screen.render();
    qt = process.hrtime();
    sdk.query_war_machine(ai_logic);
  }
}

var shooting = false;

var defTurn = 10;
var turnSpeed = 2;
var ai_logic = function(mechState) {
  //sdk.rotate_torso(0, 20, 10);

  var currentSpeed = 0;
  var travelDistance = 0;

  if(!lastPos) lastPos = new THREE.Vector3(mechState.position.x, mechState.position.y, mechState.position.z);
  var diff = process.hrtime(vt);
  var cp = new THREE.Vector3( mechState.position.x, mechState.position.y, mechState.position.z );

  travelDistance = lastPos.distanceTo(cp);
  currentSpeed = travelDistance / hrtime_to_seconds(diff);
  lastPos = cp;
  vt = process.hrtime();

  var diff = process.hrtime(qt);

  stats.setLine(3, 'Request took ' + ((diff[0] * 1e9 + diff[1]) / 1000000) + ' milliseconds');
  qt = process.hrtime();

  var chassisPower = sdk.get_chassis_total_power(mechState);
  var weapons = mechState.weapons;
  var sensors = mechState.sensors;

  var mechs = [];
  for (var i = 0; i < sensors[0].activeTargets.length; i++) {
    var t = sensors[0].activeTargets[i];
    if (t.targetId != 100) { // Ignore Self
      mechs.push({
        id: t.targetId,
        vec: new THREE.Vector3(t.targetPosition.x, t.targetPosition.y, t.targetPosition.z)
      });
    }
  }

  var rot = new THREE.Quaternion(mechState.rotation.x, mechState.rotation.y, mechState.rotation.z, mechState.rotation.w);
  var forward = new THREE.Vector3(0, 0, 1).applyQuaternion(rot);
  var right = new THREE.Vector3(1, 0, 0).applyQuaternion(rot);

  var root = new THREE.Vector3(mechState.position.x, mechState.position.y, mechState.position.z);

  if (mechs.length > 0) {
    var i = 0;
    for (var m = 0; m < mechs.length; m++) {
      if(m.id == lastTargetId){
        i = m;
        break;
      }
    }
    lastTargetId = mechs[i].id;
    mechs[i].vec.sub(root);
    mechs[i].vec.normalize();
    var angle = Math.acos(mechs[i].vec.dot(forward)) * (180.0 / Math.PI);
    stats.setLine(6, "Angle: " + angle);
    if (angle > turnSpeed || angle < -turnSpeed) {
      stats.setLine(7, "COS: " + right.dot(mechs[i].vec));
      if (right.dot(mechs[i].vec) < 0) { // On the left
        stats.setLine(8, "Turning left!");
        sdk.rotate(-Math.min(angle, turnSpeed));
      } else { // On the right
        stats.setLine(8, "Turning right!");
        sdk.rotate(Math.min(angle, turnSpeed));        
      }
    } else {
      sdk.rotate(0);
      stats.setLine(8, "Not turning!");
    }
    if (angle <= 10 && angle >= -10) {
      if(weapons[0].ammoCurrent + weapons[0].clipCurrent > 0)
        start_shooting(weapons[0], 500);      
      else if(weapons[1].ammoCurrent + weapons[1].clipCurrent > 0)
        start_shooting(weapons[1], 500); 
      else if(weapons[2].ammoCurrent + weapons[2].clipCurrent > 0)
        start_shooting(weapons[2], 500); 
    }
  } else {
    lastTargetId = -1;
    stats.setLine(8, "Default turning!");
    sdk.rotate(defTurn);
  }

  diff = process.hrtime(qt);

  stats.setLine(4, 'Logic took ' + ((diff[0] * 1e9 + diff[1]) / 1000000) + ' milliseconds');

  stats.setLine(10, "Weapon 0 Ammo: " + weapons[0].clipCurrent + "/" + weapons[0].ammoCurrent);
  stats.setLine(11, "Weapon 1 Ammo: " + weapons[1].clipCurrent + "/" + weapons[1].ammoCurrent);
  stats.setLine(12, "Weapon 2 Ammo: " + weapons[2].clipCurrent + "/" + weapons[2].ammoCurrent);

  stats.setLine(14, "Visible Target Count: " + mechs.length);

  stats.setLine(16, "Disance: " + travelDistance);
  stats.setLine(17, "Speed: " + currentSpeed);

  var ta = null;
  var i = 0;
  do {
    ta = mechState.actuators[i++];
  } while (i < mechState.actuators.length && ta.location.locationType != sdk.LOCATION_TYPE.Torso);    
  if(ta){
    stats.setLine(19, "Torso Rotation: " + ta.rotationCurrent.x + " " + ta.rotationCurrent.y + " " + ta.rotationCurrent.z + " " + ta.rotationCurrent.w);
  }

  screen.render();

  // We have a limited number of API calls per second for reads and writes so we'll throttle.
  setTimeout(function() {
    query_wm();
  }, 1000);
}

var start_shooting = function(weapon, burst) {
  if (!inGame) return;
  if (shooting) return;
  sdk.fire_weapon(weapon);
  shooting = true;
  setTimeout(function() {
    stop_shooting(weapon);
  }, burst);
}

var stop_shooting = function(weapon) {
  if (!inGame) return;
  sdk.idle_weapon(weapon);
  setTimeout(function() {
    shooting = false;
  }, 500);
}

var hrtime_to_seconds = function(t){
  var ret = t[0];
  ret += (t[1] / 1000000000.0);
  return ret;
}

assign_hooks();

sdk.connect(4000, '127.0.0.1', 'username', 'password');

setInterval(function(){  
  defTurn = -defTurn;
}, 10000);
