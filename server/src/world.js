import { performance } from 'perf_hooks';
import { World as World$1 } from 'ecsy';
import { Vector3, Euler, Quaternion, Ray, Matrix4 } from 'three';
import Ammo from 'ammo.js';

import logger from './utils/logger';
import Utils from '../../shared/utils';
import Messages from '../../shared/messages';
import Types from '../../shared/types';
import { Connection } from '../../shared/components/connection';
import { Playing } from '../../shared/components/playing';
import { Transform } from './components/transform';
import { RigidBody } from './components/rigidbody';
import { Kind } from '../../shared/components/kind';
import { Weapon } from './components/weapon';
import { Weapons } from './components/weapons';
import { Active } from './components/active';
import { Timeout } from './components/timeout';
import { Destroy } from './components/destroy';
import { Collision } from './components/collision';
import { Aim } from './components/aim';
import { Health } from './components/health';
import { Damage } from './components/damage';
import { Dead } from './components/dead';

import { PlayerInputState } from '../../shared/components/player-input-state';
import { NetworkEventSystem } from './systems/network-event-system';
import { NetworkMessageSystem } from './systems/network-message-system';
import { PlayerInputSystem } from './systems/player-input-system';
import { PhysicsSystem } from './systems/physics-system';
import { WeaponSystem } from './systems/weapon-system';
import { TimeoutSystem } from './systems/timeout-system';
import { DestroySystem } from './systems/destroy-system';
import { CollisionSystem } from './systems/collision-system';
import { HealthSystem } from './systems/health-system';

export default class World {
  constructor(id, maxClients, server) {
    this.id = id;
    this.maxClients = maxClients;
    this.server = server;
    this.updatesPerSecond = 60;
    this.lastTime = performance.now();

    this.clients = [];
    this.entities = [];

    this.connectedClients = 0;

    this.world = new World$1()
      .registerComponent(Connection)
      .registerComponent(Playing)
      .registerComponent(Transform)
      .registerComponent(RigidBody)
      .registerComponent(PlayerInputState)
      .registerComponent(Kind)
      .registerComponent(Weapon)
      .registerComponent(Weapons)
      .registerComponent(Active)
      .registerComponent(Timeout)
      .registerComponent(Destroy)
      .registerComponent(Collision)
      .registerComponent(Aim)
      .registerComponent(Health)
      .registerComponent(Damage)
      .registerComponent(Dead);

    Ammo().then((Ammo) => {
      this.world
        .registerSystem(NetworkEventSystem, this)
        .registerSystem(PlayerInputSystem)
        .registerSystem(WeaponSystem, this)
        .registerSystem(TimeoutSystem)
        .registerSystem(PhysicsSystem, { worldServer: this, ammo: Ammo })
        .registerSystem(HealthSystem, this)
        .registerSystem(CollisionSystem)
        .registerSystem(DestroySystem, this)
        .registerSystem(NetworkMessageSystem, this);
    });

    this.size = new Vector3(10, 10, 10);

    logger.info(`${this.id} running`);
  }

  init() {
    this.fixedUpdate = Utils.createFixedTimestep(
      1000/this.updatesPerSecond,
      this.handleFixedUpdate.bind(this)
    );
    setInterval(this.update.bind(this), 1000/this.updatesPerSecond);
  }

  update() {
    const time = performance.now();
    let delta = time - this.lastTime;

    if (delta > 250) {
      delta = 250;
    }

    this.fixedUpdate(delta, time);
    this.lastTime = time;
  }

  handleFixedUpdate(delta, time) {
    this.world.execute(delta, time);
  }

  handlePlayerConnect(connection) {
    logger.debug(`Adding client${connection.id} to ${this.id}`);

    connection.onDisconnect(() => {
      this.handlePlayerDisconnect(connection);
    });

    const clientId = this.getClientId();
    connection.id = clientId;

    this.clients[clientId] = this.world
      .createEntity()
      .addComponent(Connection, { value: connection });

    this.connectedClients++;

    connection.pushMessage(new Messages.Go());
  }

  handlePlayerDisconnect(connection) {
    logger.debug(`Deleting player ${connection.id}`);

    const entity = this.clients[connection.id];

    if (entity.hasComponent(Playing)) {
      this.broadcast(new Messages.Despawn(entity.worldId));
    }

    entity.remove();
    delete this.clients[connection.id];
    delete this.entities[entity.worldId];
    this.connectedClients--;
  }

  addPlayer(clientId) {
    logger.debug(`Creating player ${clientId}`);
    const clientEntity = this.clients[clientId];
    const entityId = this.getEntityId();

    clientEntity.worldId = entityId;

    const player = clientEntity
      .addComponent(Playing)
      .addComponent(Kind, { value: Types.Entities.SPACESHIP })
      .addComponent(Transform, {
        position: this.getRandomPosition()
      })
      .addComponent(PlayerInputState)
      .addComponent(RigidBody, {
        acceleration: 0.8,
        angularAcceleration: new Euler(0.15, 0.3, 0.05),
        damping: 0.5,
        angularDamping: 0.99
      })
      .addComponent(Aim)
      .addComponent(Health);

    const weaponLeft = this.world
      .createEntity()
      .addComponent(Weapon, {
        offset: new Vector3(-0.5, 0, -0.5),
        fireInterval: 100,
        parent: player
      });

    const weaponRight = this.world
      .createEntity()
      .addComponent(Weapon, {
        offset: new Vector3(0.5, 0, -0.5),
        fireInterval: 100,
        parent: player
      });

    player.addComponent(Weapons, {
      primary: [weaponLeft, weaponRight]
    });

    this.entities[entityId] = player;
  }

  addBullet(weapon) {
    const entityId = this.getEntityId();
    const parentTransform = weapon.parent.getComponent(Transform);

    const pos = new Vector3().copy(weapon.offset)
      .applyQuaternion(parentTransform.rotation)
      .add(parentTransform.position);
    let rot = parentTransform.rotation;

    if (weapon.parent.hasComponent(Aim)) {
      const ray = weapon.parent.getComponent(Aim);

      const target = new Vector3();
      new Ray(ray.position, ray.direction).at(ray.distance, target);

      const direction = new Vector3();
      direction.subVectors(pos, target).normalize();

      const mx = new Matrix4().lookAt(direction, new Vector3(0,0,0), new Vector3(0,1,0));
      const qt = new Quaternion().setFromRotationMatrix(mx);
      rot = qt;
    }

    const bulletEntity = this.world
      .createEntity()
      .addComponent(Kind, { value: Types.Entities.BULLET })
      .addComponent(Transform, { position: pos, rotation: rot })
      .addComponent(RigidBody, {
        velocity: new Vector3(0, 0, -0.1),
        kinematic: true
      })
      .addComponent(Timeout, {
        timer: 500,
        addComponents: [Destroy]
      })
      .addComponent(Damage, { value: 5 });

    bulletEntity.worldId = entityId;

    this.entities[entityId] = bulletEntity;

    const { position, rotation, scale } = bulletEntity.getComponent(Transform);
    this.broadcast(new Messages.Spawn(
      bulletEntity.worldId,
      Types.Entities.BULLET,
      position,
      rotation,
      scale
    ));
  }

  getRandomPosition() {
    return new Vector3(
      Utils.random(this.size.x + 1) - this.size.x/2,
      Utils.random(this.size.y + 1) - this.size.y/2,
      Utils.random(this.size.z + 1) - this.size.z/2
    );
  }

  broadcast(message, ignoredPlayerId = null) {
    for (const [id, entity] of this.clients.entries()) {
      if (id == ignoredPlayerId || !entity || !entity.alive || entity.hasComponent(Destroy) ||
          !entity.hasComponent(Connection) || entity.hasComponent(Dead)) {
        continue;
      }

      const connection = entity.getComponent(Connection).value;
      connection.pushMessage(message);
    }
  }

  getClientId() {
    for (let i = 0; i < this.clients.length; ++i) {
      if (!this.clients[i]) {
        return i;
      }
    }

    return this.clients.length;
  }

  getEntityId() {
    for (let i = 0; i < this.entities.length; ++i) {
      if (!this.entities[i]) {
        return i;
      }
    }

    return this.entities.length;
  }

  spawnAsteroids(count) {
    const rng = Utils.randomNumberGenerator(5);

    for (let i = 0; i < count; ++i) {
      const scaleValue = [1, 5, 10, 20, 40, 60, 120, 240, 560];
      const scale = scaleValue[Math.floor(rng() * scaleValue.length)];

      const rotation = new Quaternion();
      rotation.setFromAxisAngle(new Vector3(1, 0, 0), rng() * Math.PI * 2);
      rotation.setFromAxisAngle(new Vector3(0, 1, 0), rng() * Math.PI * 2);
      rotation.setFromAxisAngle(new Vector3(0, 0, 1), rng() * Math.PI * 2);

      const asteroid = this.world.createEntity()
        .addComponent(Kind, { value: Types.Entities.ASTEROID })
        .addComponent(Transform, {
          position: new Vector3(
            (rng() - 0.5) * 800,
            (rng() - 0.5) * 800,
            (rng() - 0.5) * 800
          ),
          rotation,
          scale
        })
        .addComponent(RigidBody, {
          acceleration: 0,
          angularAcceleration: new Euler(0, 0, 0),
          damping: 0.001,
          angularDamping: 0.1,
          weight: scale <= 5 ? 1 : 0
        });

      const entityId = this.getEntityId();
      asteroid.worldId = entityId;

      this.entities[entityId] = asteroid;
    }
  }
}
