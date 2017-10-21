class Entity {
  constructor(scene, size) {
    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, size.y, size.z),
      new THREE.MeshPhongMaterial({color: 0xff0000})
    );
    scene.add(this.mesh);
  }

  setOrientation(position, rotation) {
    this.mesh.position.set(position.x, position.y, position.z);
    this.mesh.rotation.set(rotation.x, rotation.y, rotation.z);
  }
}

class Player extends Entity {
  constructor(scene) {
    super(scene, new THREE.Vector3(1, 1, 1));
    this.scene = scene;

    this.speed = 2; // units/s

    this.bullets = [];

    this.positionBuffer = [];

    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;

    this.healthBar = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.1, 0),
      new THREE.MeshBasicMaterial({color: 0x00ff00})
    );
    this.healthBar.geometry.translate(this.healthBar.geometry.parameters.width / 2, 0, 0 );
    this.healthBar.geometry.verticesNeedUpdate = true;
    this.healthBar.position.x -= this.healthBar.geometry.parameters.width / 2;
    this.healthBarPivot = new THREE.Object3D();
    this.healthBarPivot.add(this.healthBar);
    this.scene.add(this.healthBarPivot);
  }

  destroy() {
    this.scene.remove(this.mesh);
    this.scene.remove(this.healthBarPivot);
  }

  updateHealth(health) {
    this.healthBar.scale.x = health / 100;
    if (this.healthBar.scale.x == 0) {
      this.healthBar.scale.x = 0.00001;
    }
  }

  updateHealthBarOrientation(camera) {
    this.healthBarPivot.position.copy(this.mesh.position);
    let height = this.healthBar.geometry.parameters.width;
    this.healthBarPivot.position.y = height + height / 3;
    this.healthBarPivot.lookAt(camera.getWorldPosition());
  }

  applyInput(input) {
    if (input.keys.includes('forward')) this.mesh.translateZ(-this.speed * input.pressTime);
    if (input.keys.includes('left')) this.mesh.rotation.y += this.speed * input.pressTime;
    if (input.keys.includes('right')) this.mesh.rotation.y -= this.speed * input.pressTime;
  }
}

class Bullet extends Entity {
  constructor(scene, position, rotation) {
    super(scene, new THREE.Vector3(0.2, 0.2, 0.2));
    this.scene = scene;

    this.speed = 10;

    this.mesh.position.set(position.x, position.y, position.z);
    this.mesh.rotation.set(rotation.x, rotation.y, rotation.z);
  }

  destroy() {
    this.scene.remove(this.mesh);
  }
}

class Client {
  constructor() {
    this.ws = new WebSocket('ws://localhost:8080');
    this.ws.onopen = this.onConnection.bind(this);
    this.ws.onmessage = this.processServerMessages.bind(this);

    this.serverUpdateRate = 20;

    this.id = null;

    this.players = {};

    this.setUpdateRate(60);

    this.keys = {
      left: false,
      right: false
    };

    document.body.onkeydown = this.processEvents.bind(this);
    document.body.onkeyup = this.processEvents.bind(this);

    this.inputSequenceNumber = 0;
    this.pendingInputs = [];
  }

  onConnection() {
    console.log('Connected to server');

    this.renderer = new THREE.WebGLRenderer();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    document.getElementById('container').appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 10000);
    this.camera.position.z = 15;
    this.camera.position.y = 2;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    let light = new THREE.PointLight(0xffffff, 0.8, 18);
    light.position.set(3, 12, 3);
    light.castShadow = true;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = 25;
    this.scene.add(light);

    let plane = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshPhongMaterial({color:0xffffff})
    );
    plane.rotation.x -= Math.PI / 2;
    plane.receiveShadow = true;
    this.scene.add(plane);
  }

  processEvents(event) {
    if (event.key == 'w' || event.keyCode == 38) this.keys.forward = event.type == 'keydown';
    if (event.key == 'a' || event.keyCode == 37) this.keys.left = event.type == 'keydown';
    if (event.key == 'd' || event.keyCode == 39) this.keys.right = event.type == 'keydown';
    if (event.keyCode == 32) this.keys.shoot = event.type == 'keydown';
  }

  processInputs(dt) {
    if ((!this.keys.left && !this.keys.right && !this.keys.forward && !this.keys.shoot) ||
         (this.keys.left && this.keys.right && !this.keys.forward)) {
      return;
    }

    let input = {
      id: this.id,
      pressTime: dt,
      inputSequenceNumber: this.inputSequenceNumber++,
      keys: ''
    };

    if (this.keys.forward) input.keys += 'forward';
    if (this.keys.left) input.keys += 'left';
    if (this.keys.right) input.keys += 'right';
    if (this.keys.shoot) input.keys += 'shoot';

    this.ws.send(JSON.stringify(input));

    // do client-side prediction
    this.players[this.id].applyInput(input);

    // save this input for later reconciliation
    this.pendingInputs.push(input);
  }

  setUpdateRate(hz) {
    this.updateRate = hz;

    clearInterval(this.updateInterval);
    this.updateInterval = setInterval(this.update.bind(this), 1000 / this.updateRate);
  }

  update() {
    let nowTs = +new Date();
    let lastTs = this.lastTs || nowTs;
    let dt = (nowTs - lastTs) / 1000.0;
    this.lastTs = nowTs;

    if (this.id == null) return;

    this.processInputs(dt);
    this.interpolateEntities(dt);
    this.render();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  processServerMessages(event) {
    let message = JSON.parse(event.data);

    switch(message.type) {
      case 'id':
        this.id = message.id;
        console.log(`Client ID set to: ${this.id}`);
        break;
      case 'worldState':
        for (let i = 0; i < message.states.length; i++) {
          let state = message.states[i];

          // if this is the first time we see this player, create local representation
          if (!this.players[state.id]) {
            let player = new Player(this.scene);
            player.id = state.id;
            player.setOrientation(state.position, state.rotation);

            for (let i = 0; i < state.bullets.length; i++) {
              let bullet = state.bullets[i];
              player.bullets.push(new Bullet(this.scene, bullet.position, bullet.rotation));
            }

            if (state.id == this.id) player.mesh.add(this.camera);

            this.players[state.id] = player;
          }

          let player = this.players[state.id];
          player.updateHealth(state.health)

          while (player.bullets.length > state.bullets.length) {
            player.bullets.shift().destroy();
          }

          while (player.bullets.length < state.bullets.length) {
            player.bullets.push(new Bullet(this.scene, player.mesh.position, player.mesh.rotation));
          }

          for (let i = 0; i < player.bullets.length; i++) {
            let bullet = player.bullets[i];
            let position = state.bullets[i].position;
            let rotation = state.bullets[i].rotation;

            bullet.mesh.position.set(position.x, position.y, position.z);
            bullet.mesh.rotation.set(rotation.x, rotation.y, rotation.z);
          }

          if (state.id == this.id) {
            // received the authoritative positon of this client's player
            player.setOrientation(state.position, state.rotation);

            let j = 0;
            while (j < this.pendingInputs.length) {
              let input = this.pendingInputs[j];
              if (input.inputSequenceNumber <= state.lastProcessedInput) {
                // Already processed; its effect is already taken into
                // account into the world update.
                this.pendingInputs.splice(j, 1);
              } else {
                player.applyInput(input);
                j++;
              }
            }
          } else {
            // received the position of an player other than this client
            let timestamp = +new Date();
            player.positionBuffer.push([timestamp, state.position, state.rotation]);
          }
        }
        break;
      case 'disconnect':
        if (this.players[message.id]) {
          console.log(`Client ${message.id} disconnected`);
          this.players[message.id].destroy();
          delete this.players[message.id];
        }
        break;
    }
  }

  interpolateEntities(dt) {
    let now = +new Date();
    let renderTimestamp = now - (1000.0 / this.serverUpdateRate);

    for (let i in this.players) {
      let player = this.players[i];

      player.updateHealthBarOrientation(this.camera);

      for (let j = 0; j < player.bullets.length; j++) {
        let bullet = player.bullets[j];
        bullet.mesh.translateZ(-bullet.speed * dt);
      }

      if (player.id == this.id) continue;

      let buffer = player.positionBuffer;

      while (buffer.length >= 2 && buffer[1][0] <= renderTimestamp) {
        buffer.shift();
      }

      if (buffer.length >= 2 && buffer[0][0] <= renderTimestamp && renderTimestamp <= buffer[1][0]) {
        let p0 = buffer[0][1];
        let p1 = buffer[1][1];
        let r0 = buffer[0][2];
        let r1 = buffer[1][2];
        let t0 = buffer[0][0];
        let t1 = buffer[1][0];

        player.mesh.position.x = p0.x + (p1.x - p0.x) * (renderTimestamp - t0) / (t1 - t0);
        player.mesh.position.y = p0.y + (p1.y - p0.y) * (renderTimestamp - t0) / (t1 - t0);
        player.mesh.position.z = p0.z + (p1.z - p0.z) * (renderTimestamp - t0) / (t1 - t0);

        player.mesh.rotation.x = r0.x + (r1.x - r0.x) * (renderTimestamp - t0) / (t1 - t0);
        player.mesh.rotation.y = r0.y + (r1.y - r0.y) * (renderTimestamp - t0) / (t1 - t0);
        player.mesh.rotation.z = r0.z + (r1.z - r0.z) * (renderTimestamp - t0) / (t1 - t0);
      }
    }
  }
}

const client = new Client();