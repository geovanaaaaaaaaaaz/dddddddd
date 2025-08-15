const mineflayer = require('mineflayer');
const fs = require('fs');
const { Vec3 } = require('vec3');

// Read and parse server IP and port from server.txt
const serverRaw = fs.readFileSync('server.txt', 'utf8').trim();
const [serverIP, serverPortString] = serverRaw.split(':');
const serverPort = serverPortString ? parseInt(serverPortString, 10) : 25565; // default Minecraft port

// Read user and bot data from files
const masterUsername = fs.readFileSync('usermaster.txt', 'utf8').trim();
const approvedUsers = fs.readFileSync('userparty.txt', 'utf8').trim().split('\n').map(line => line.trim());
const credentials = fs.readFileSync('user.txt', 'utf8').trim().split('\n').map(line => {
  const [username, password] = line.trim().split(':');
  return { username, password };
});

let reconnectAttempts = {};
const maxReconnectAttempts = 5;

// Helper function to create a random delay
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Helper function to stop all movement
function stopAllMovement(bot) {
  bot.setControlState('forward', false);
  bot.setControlState('sprint', false);
  bot.setControlState('jump', false);
  bot.setControlState('back', false);
  bot.setControlState('left', false);
  bot.setControlState('right', false);
  bot.setControlState('sneak', false);
}

// Function to create and manage a single bot
function createBot({ username, password }, botIndex) {
  const bot = mineflayer.createBot({
    host: serverIP,
    port: serverPort,
    username,
    version: '1.8.9',
  });

  reconnectAttempts[username] = 0;
  
  // State variables for bot behavior
  let followMaster = false; // Changed: Start with following disabled
  let combatWalkMode = false; // Triggered by enemy kill messages
  let masterHurtWalk = false; // Triggered when hit by master
  let botActive = false; // New: Bot is inactive until "go" command

  // ================== Frozen System ==================

  // State variables
  let isFrozen = false;
  let frozenPosition = null;
  let frozenYaw = null;
  let freezeIntervalId = null;
  let lastMasterHurtTime = 0;
  const masterHurtCooldown = 5000; // 5 sec cooldown to prevent spam freezing

  // Freeze the bot
  function freezeBot() {
    if (isFrozen) return;

    isFrozen = true;
    console.log(`[${bot.username}] is now frozen! ❄️ Simulating lag and immobility.`);

    // Save current position and yaw
    frozenPosition = bot.entity.position.clone();
    frozenYaw = bot.entity.yaw;

    // Stop movement immediately
    stopAllMovement(bot);

    // Simulate "laggy" immobility
    freezeIntervalId = setInterval(() => {
      if (frozenPosition) {
        bot.entity.position = frozenPosition;
        bot.look(frozenYaw, bot.entity.pitch, true);

        if (Math.random() > 0.5) {
          bot.entity.velocity.set(0, 0, 0);
        }

        bot.setControlState('forward', false);
        bot.setControlState('sprint', false);
        bot.setControlState('jump', false);
        bot.setControlState('back', false);
        bot.setControlState('left', false);
        bot.setControlState('right', false);
        bot.setControlState('sneak', false);
      }
    }, randomDelay(50, 150)); // Variable delay for realism
  }

  // Unfreeze the bot
  function unfreezeBot() {
    if (!isFrozen) return;

    isFrozen = false;
    console.log(`[${bot.username}] is now unfrozen! 🧊`);

    if (freezeIntervalId) {
      clearInterval(freezeIntervalId);
      freezeIntervalId = null;
    }

    frozenPosition = null;
    frozenYaw = null;

    // Resume normal behavior shortly after unfreezing
    setTimeout(() => {
      if (botActive && followMaster) {
        detectAndFollowMaster(bot, bot.username);
      }
    }, 100);
  }

  // ================== End Frozen System ==================

  bot.once('spawn', () => {
    console.log(`[${username}] Bot joined the server`);
    bot.chat(`/login ${password}`);

    // Start the main behavior loops but only some functions
    randomPlayerActions(bot);
    // Note: detectAndFollowMaster and blockDetectionAndJump only start when bot is active
  });

  // Freeze and hold position with zero velocity on physicsTick
  bot.on('physicsTick', () => {
    if (isFrozen && frozenPosition && bot.entity) {
      // Zero out velocity
      bot.entity.velocity.x = 0;
      bot.entity.velocity.y = 0;
      bot.entity.velocity.z = 0;

      // Teleport bot back exactly to frozen position to prevent drifting
      bot.entity.position.x = frozenPosition.x;
      bot.entity.position.y = frozenPosition.y;
      bot.entity.position.z = frozenPosition.z;

      // Also clear all control inputs just in case
      bot.clearControlStates();
    }
  });

  function detectAndFollowMaster(bot, username) {
    let lastLogTime = 0;
    const logInterval = 30000;

    const followInterval = setInterval(() => {
      // Only follow if bot is active and none of the temporary walk/freeze modes are active
      if (!botActive || !followMaster || combatWalkMode || masterHurtWalk || isFrozen) return;

      const master = bot.players[masterUsername]?.entity;
      
      // If the bot is falling into the void, make it jump (only if bot is active)
      if (botActive && bot.entity.position.y < 5) {
        console.log(`[${username}] Below void threshold, jumping`);
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), randomDelay(200, 500));
        return;
      }

      // If master is not found, log a message and do nothing
      if (!master) {
        const currentTime = Date.now();
        if (currentTime - lastLogTime > logInterval) {
          console.log(`[${username}] ${masterUsername} not nearby`);
          lastLogTime = currentTime;
        }
        return;
      }

      const distance = bot.entity.position.distanceTo(master.position);
      if (distance > 100) {
        // If too far away, stop moving
        bot.setControlState('forward', false);
        bot.setControlState('sprint', false);
        return;
      } else if (distance > 1) {
        // If not too far but not close enough, look at and move towards master
        bot.lookAt(master.position.offset(0, master.height / 2, 0));
        setTimeout(() => {
          bot.setControlState('forward', true);
          bot.setControlState('sprint', true);
        }, randomDelay(100, 500));
      } else {
        // If close enough, stop moving
        bot.setControlState('forward', false);
        bot.setControlState('sprint', false);
      }
    }, 100 + randomDelay(50, 150));

    // Store interval reference to clear it when bot becomes inactive
    bot.followInterval = followInterval;
  }

  function randomPlayerActions(bot) {
    setInterval(() => {
      // Don't perform random actions if bot is inactive or in a special mode
      if (!botActive || combatWalkMode || masterHurtWalk || isFrozen) return;

      if (Math.random() < 0.1) {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), randomDelay(200, 500));
      }

      if (Math.random() < 0.05) {
        bot.setControlState('sneak', true);
        setTimeout(() => bot.setControlState('sneak', false), randomDelay(1000, 3000));
      }

      if (Math.random() < 0.2) {
        const randomYaw = Math.random() * Math.PI * 2;
        const randomPitch = (Math.random() - 0.5) * Math.PI / 2;
        bot.look(randomYaw, randomPitch);
      }
    }, randomDelay(2000, 5000));
  }

  function blockDetectionAndJump(bot) {
    let isInVoid = false;

    const blockInterval = setInterval(() => {
      // Don't perform block detection if bot is inactive or in a special mode
      if (!botActive || combatWalkMode || masterHurtWalk || isFrozen) return;

      const yaw = bot.entity.yaw;
      const forwardVector = {
        x: -Math.sin(yaw),
        z: Math.cos(yaw)
      };

      const forwardBlockPosition = bot.entity.position.offset(forwardVector.x, 0, forwardVector.z);
      const blockInFront = bot.blockAt(forwardBlockPosition);
      const blockBelow = bot.blockAt(bot.entity.position.offset(0, -1, 0));

      if (!blockBelow || blockBelow.name === 'air') {
        if (!isInVoid) {
          console.log(`[${bot.username}] Void detected, jumping`);
          isInVoid = true;
        }
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), randomDelay(200, 500));
      } else {
        isInVoid = false;
      }

      if (blockInFront && blockInFront.boundingBox === 'block') {
        console.log(`[${bot.username}] Block ahead, jumping`);
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), randomDelay(200, 500));
      }
    }, 100);

    // Store interval reference to clear it when bot becomes inactive
    bot.blockInterval = blockInterval;
  }

  bot.on('message', (message) => {
    const messageText = message.toString();

    // Filter out common server spam messages
    if (
      messageText.includes('https://store.blocksmc.com') ||
      messageText.includes('https://discord.gg/') ||
      messageText.includes('Join our discord') ||
      messageText.includes('/Discord') ||
      messageText.includes('/Store') ||
      messageText === ''
    ) return;

    console.log(`[${bot.username}] Message: ${messageText}`);

    // Check for successful login message and walk forward for 2 seconds
    if (messageText.includes('Successful Login.')) {
      console.log(`[${bot.username}] Login successful! Walking forward for 2 seconds to join server properly.`);
      
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      
      setTimeout(() => {
        bot.setControlState('forward', false);
        bot.setControlState('sprint', false);
        console.log(`[${bot.username}] Finished initial walk, waiting for commands.`);
      }, 2000); // 2 seconds
      
      return;
    }

    // Check for party commands from master
    if (messageText.includes(`PARTY ▏ ${masterUsername} » go`)) {
      console.log(`[${bot.username}] Received GO command from master - Bot activating!`);
      botActive = true;
      followMaster = true;
      
      // Start the following and block detection functions
      detectAndFollowMaster(bot, bot.username);
      blockDetectionAndJump(bot);
      
      return;
    }

    if (messageText.includes(`PARTY ▏ ${masterUsername} » stop`)) {
      console.log(`[${bot.username}] Received STOP command from master - Bot deactivating!`);
      botActive = false;
      followMaster = false;
      
      // Stop all movement
      stopAllMovement(bot);
      
      // Clear intervals if they exist
      if (bot.followInterval) {
        clearInterval(bot.followInterval);
        bot.followInterval = null;
      }
      if (bot.blockInterval) {
        clearInterval(bot.blockInterval);
        bot.blockInterval = null;
      }
      
      // If bot is frozen, unfreeze it
      if (isFrozen) {
        unfreezeBot();
      }
      
      return;
    }

    // Check for enemy kill message to trigger a combat walk (only if bot is active)
    if (botActive && messageText.includes('Your enemy') && messageText.includes('still had') && messageText.includes('hearts remaining')) {
      console.log(`[${bot.username}] Enemy detected! Stop following and walk forward for 5.6 seconds`);
      
      // If bot is frozen, unfreeze it first
      if (isFrozen) {
        console.log(`[${bot.username}] Unfreezing due to enemy kill message: "${messageText}"`);
        unfreezeBot();
      }
      
      // Stop following master and start walking
      followMaster = false;
      combatWalkMode = true;
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      
      // Stop walking after 5.6 seconds and resume following
      setTimeout(() => {
        bot.setControlState('forward', false);
        bot.setControlState('sprint', false);
        followMaster = true;
        combatWalkMode = false;
        console.log(`[${bot.username}] Combat walk complete, resuming following`);
      }, 5600);
      
      return;
    }

    // Respond to master's chat messages by going to hub (only if bot is active)
    if (botActive && message.extra && message.extra[0] && message.extra[0].text.includes(masterUsername)) {
      console.log(`[${bot.username}] Master sent message. Executing /hub.`);
      bot.chat('/hub');
      return;
    }

    // Accept party requests from approved users
    if (messageText.includes('New party request from') && messageText.includes('[ACCEPT]')) {
      const match = messageText.match(/New party request from (\w+)\. \[ACCEPT\]/);
      if (match) {
        const requester = match[1];
        if (approvedUsers.includes(requester)) {
          bot.chat(`/p accept ${requester}`);
          console.log(`[${bot.username}] Accepted party from ${requester}`);
        } else {
          console.log(`[${bot.username}] Ignored party request from ${requester}`);
        }
      }
    }
  });

  // Enhanced frozen system: Bot health changes (unfreeze if very low HP)
  bot.on('health', () => {
    if (bot.health <= 4) { // Changed from < 2 to <= 4 (2 hearts)
      if (isFrozen) {
        console.log(`[${bot.username}] HEALTH LOW EVENT: ${bot.health} HP → Unfreezing.`);
        unfreezeBot();
      }
      
      // Also stop combat walk mode if health is low
      if (combatWalkMode) {
        console.log(`[${bot.username}] HEALTH LOW: ${bot.health} HP → Stopping combat walk.`);
        bot.setControlState('forward', false);
        bot.setControlState('sprint', false);
        followMaster = true;
        combatWalkMode = false;
      }
    }
  });

  // Enhanced frozen system: Bot hurt (freeze if attacked by master, unfreeze if low HP)
  bot.on('entityHurt', (hurtEntity) => {
    const currentTime = Date.now();

    // Only react if the bot is the one hurt and bot is active
    if (botActive && hurtEntity.username === bot.username && (currentTime - lastMasterHurtTime > masterHurtCooldown)) {
      // If low HP → unfreeze
      if (bot.health <= 4) { // Changed from < 2 to <= 4 (2 hearts)
        console.log(`[${bot.username}] HEALTH LOW: ${bot.health} HP → Unfreezing.`);
        unfreezeBot();
        return;
      }

      // If attacked by master and nearby → freeze
      const attacker = bot.players[masterUsername]?.entity;
      if (attacker && hurtEntity.position.distanceTo(attacker.position) < 5) {
        freezeBot();
        lastMasterHurtTime = currentTime;
      }
    }

    // Original behavior: Start a temporary walk when hit by master (if not frozen and bot is active)
    if (botActive && hurtEntity === bot.entity && !isFrozen) {
      const attacker = bot.nearestEntity(e => e.type === 'player' && e.username === masterUsername);
      if (attacker) {
        console.log(`[${bot.username}] Hit by master, starting a 7-second walk!`);
        // Disable following and enable temporary walk mode
        followMaster = false;
        masterHurtWalk = true;
        bot.setControlState('forward', true);
        bot.setControlState('sprint', true);

        // Set a timeout to end the walk and resume following
        setTimeout(() => {
          bot.setControlState('forward', false);
          bot.setControlState('sprint', false);
          followMaster = true;
          masterHurtWalk = false;
          console.log(`[${bot.username}] Walk complete, resuming following master`);
        }, 7000); // 7-second walk as requested
      }
    }
  });

  bot.on('error', (err) => {
    console.log(`[${bot.username}] Error: ${err}`);
    attemptReconnect({ username, password });
  });

  bot.on('end', () => {
    console.log(`[${bot.username}] Disconnected from server`);
    attemptReconnect({ username, password });
  });
}

function attemptReconnect({ username, password }) {
  if (reconnectAttempts[username] < maxReconnectAttempts) {
    reconnectAttempts[username]++;
    console.log(`[${username}] Attempting reconnect... (${reconnectAttempts[username]}/${maxReconnectAttempts})`);
    setTimeout(() => {
      createBot({ username, password });
    }, Math.pow(2, reconnectAttempts[username]) * 5000);
  } else {
    console.log(`[${username}] Max reconnect attempts reached. Giving up.`);
  }
}

// Spawn each bot with 5s delay
credentials.forEach((cred, i) => {
  setTimeout(() => {
    createBot(cred, i);
  }, i * 5000);
});