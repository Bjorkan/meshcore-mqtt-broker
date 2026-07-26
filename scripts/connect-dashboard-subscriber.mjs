import mqtt from "mqtt";

const client = mqtt.connect("ws://127.0.0.1:8883", {
  username: "visual-review",
  password: "visual-review",
  clientId: "dashboard-review-subscriber",
  reconnectPeriod: 0,
});

client.on("connect", () => {
  console.log("Dashboard review subscriber connected");
  client.subscribe(
    ["meshcore/#", "heartbeat/#", "status/#"],
    (err, granted) => {
      if (err) {
        console.error("Subscriber subscribe error:", err);
        client.end(true, () => process.exit(1));
        return;
      }
      console.log(
        "Dashboard review subscriber ready:",
        granted.map((g) => g.topic).join(", "),
      );
    },
  );
});

client.on("error", (error) => {
  console.error("Subscriber error:", error);
  process.exitCode = 1;
  client.end(true, () => process.exit(1));
});

process.on("SIGTERM", () => {
  client.end();
});
