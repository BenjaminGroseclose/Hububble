import Phaser from "phaser";

import { io } from "socket.io-client";

export default class MainScene extends Phaser.Scene {
  constructor() {
    super("MainScene");
    this.state = {};
  }

  preload() {
    this.load.spritesheet("bubble", "assets/sprites/bubble.png", {
      frameWidth: 16,
      frameHeight: 16,
    });
    this.load.image("mainroom", "assets/backgrounds/mainroom.png");
  }

  create() {
    const scene = this;
    this.cameras.main.setZoom(4); // 4x zoom
    this.cameras.main.setBounds(0, 0, 200, 150);

    this.add.image(100, 75, "mainroom");

    this.socket = io(
      "https://agreeable-flower-06f64ce0f.6.azurestaticapps.net",
      {
        transports: ["websocket"],
      }
    );

    console.log(this.socket);

    scene.scene.launch("WaitingRoom", { socket: scene.socket });

    console.log(scene);

    this.otherPlayers = this.physics.add.group();

    // Add mouse-based movement
    this.input.on("pointerdown", function (pointer) {
      if (scene.bubble) {
        scene.targetPointer = { x: pointer.worldX, y: pointer.worldY };
        scene.isMouseDown = true;
      }
    });

    this.input.on("pointerup", function () {
      if (scene.bubble) {
        scene.isMouseDown = false;
        scene.bubble.body.setVelocity(0);
      }
    });

    this.socket.on("setState", function (state) {
      const { roomKey, players, numPlayers } = state;
      scene.physics.resume();

      scene.state.roomKey = roomKey;
      scene.state.players = players;
      scene.state.numPlayers = numPlayers;
    });

    this.socket.on("currentPlayers", function (arg) {
      const { players, numPlayers } = arg;
      scene.state.numPlayers = numPlayers;
      Object.keys(players).forEach(function (id) {
        if (players[id].playerId === scene.socket.id) {
          scene.addPlayer(scene, players[id]);
        } else {
          scene.addOtherPlayers(scene, players[id]);
        }
      });
    });

    this.socket.on("newPlayer", function (arg) {
      const { playerInfo, numPlayers } = arg;
      scene.addOtherPlayers(scene, playerInfo);
      scene.state.numPlayers = numPlayers;
    });

    this.socket.on("playerMoved", function (playerInfo) {
      scene.otherPlayers.getChildren().forEach(function (otherPlayer) {
        if (playerInfo.playerId === otherPlayer.playerId) {
          const oldX = otherPlayer.x;
          const oldY = otherPlayer.y;
          otherPlayer.setPosition(playerInfo.x, playerInfo.y);
        }
      });
    });
    this.cursors = this.input.keyboard.createCursorKeys();

    this.socket.on("playerDisconnected", function (arg) {
      const { playerId, numPlayers } = arg;
      scene.state.numPlayers = numPlayers;

      // Remove the disconnected player's sprite
      scene.otherPlayers.getChildren().forEach(function (otherPlayer) {
        if (playerId === otherPlayer.playerId) {
          otherPlayer.destroy();
        }
      });

      // Remove the player from the state
      if (scene.state.players) {
        delete scene.state.players[playerId];
      }
    });

    // Chat UI
    this.chatInput = this.add.dom(100, 90).createFromHTML(`
            <input type="text" id="chat-input" placeholder="Type a message..." style="width: 50px;" />
        `);
    this.chatInput.addListener("keydown");
    this.chatInput.on("keydown", function (event) {
      if (event.key === "Enter") {
        const inputElement = document.getElementById("chat-input");
        const message = inputElement.value.trim();
        if (message) {
          scene.socket.emit("chatMessage", {
            roomKey: scene.state.roomKey,
            message,
            playerId: scene.socket.id,
          });
          inputElement.value = ""; // Clear input
        }
      }
    });

    // Display chat messages
    this.chatMessages = this.add.text(10, 10, "", {
      fontSize: "12px",
      fill: "#000000",
      wordWrap: { width: 180 },
    });

    this.socket.on("chatMessage", function (data) {
      const { playerId, message } = data;
      const newMessage = `${playerId}: ${message}\n`;
      scene.chatMessages.setText(scene.chatMessages.text + newMessage);
    });
  }

  update() {
    const scene = this;

    if (this.bubble) {
      const speed = 50;

      // Handle mouse-based movement
      if (scene.isMouseDown && scene.targetPointer) {
        const angle = Phaser.Math.Angle.Between(
          this.bubble.x,
          this.bubble.y,
          scene.targetPointer.x,
          scene.targetPointer.y
        );

        this.bubble.body.setVelocity(
          Math.cos(angle) * speed,
          Math.sin(angle) * speed
        );

        // Stop moving if the player reaches the target
        const distance = Phaser.Math.Distance.Between(
          this.bubble.x,
          this.bubble.y,
          scene.targetPointer.x,
          scene.targetPointer.y
        );

        if (distance < speed / 10) {
          this.bubble.body.setVelocity(0);
          scene.targetPointer = null;
        }
      } else {
        // Handle keyboard-based movement
        this.bubble.body.setVelocity(0);

        if (this.cursors.left.isDown) {
          this.bubble.body.setVelocityX(-speed);
        } else if (this.cursors.right.isDown) {
          this.bubble.body.setVelocityX(speed);
        }

        if (this.cursors.up.isDown) {
          this.bubble.body.setVelocityY(-speed);
        } else if (this.cursors.down.isDown) {
          this.bubble.body.setVelocityY(speed);
        }

        this.bubble.body.velocity.normalize().scale(speed);
      }

      const x = this.bubble.x;
      const y = this.bubble.y;

      if (
        this.bubble.oldPosition &&
        (x !== this.bubble.oldPosition.x || y !== this.bubble.oldPosition.y)
      ) {
        this.socket.emit("playerMovement", {
          x: this.bubble.x,
          y: this.bubble.y,
          roomKey: scene.state.roomKey,
        });
      }

      this.bubble.oldPosition = {
        x: this.bubble.x,
        y: this.bubble.y,
        rotation: this.bubble.rotation,
      };
    }
  }

  addPlayer(scene, playerInfo) {
    scene.joined = true;
    scene.bubble = scene.physics.add.sprite(
      playerInfo.x,
      playerInfo.y,
      "bubble"
    );

    // Configure camera to follow player with smooth movement
    scene.cameras.main.startFollow(scene.bubble, true, 0.1, 0.1);
    scene.cameras.main.setFollowOffset(0, 0); // Center the player on the screen

    // Set deadzone to null to ensure camera always tries to center the player
    scene.cameras.main.setDeadzone(0, 0);

    // Adjust bounds if needed to ensure player can move throughout the entire game world
    // Comment out the next line if you don't want the camera bounded
    // scene.cameras.main.setBounds(0, 0, 200, 100);
  }

  addOtherPlayers(scene, playerInfo) {
    const otherPlayer = scene.add.sprite(playerInfo.x, playerInfo.y, "bubble");
    otherPlayer.playerId = playerInfo.playerId;
    scene.otherPlayers.add(otherPlayer);
  }
}
