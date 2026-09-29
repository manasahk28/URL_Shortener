const cluster = require("cluster");
const os = require("os");

const numCPUs = Math.min(os.cpus().length, 4); // Use up to 4 worker processes

if (cluster.isPrimary || cluster.isMaster) {
    console.log(`\n======================================================`);
    console.log(`⚡ Primary Cluster Process ${process.pid} is running`);
    console.log(`⚡ Forking ${numCPUs} worker processes for load distribution...`);
    console.log(`======================================================\n`);

    for (let i = 0; i < numCPUs; i++) {
        cluster.fork({ INSTANCE_ID: `cluster-worker-${i + 1}` });
    }

    cluster.on("online", (worker) => {
        console.log(` Worker ${worker.process.pid} is online and ready for traffic`);
    });

    cluster.on("exit", (worker, code, signal) => {
        console.warn(` Worker ${worker.process.pid} died (${signal || code}). Spawning replacement worker...`);
        cluster.fork();
    });
} else {
    // Workers share the same TCP server port (3000)
    require("./server.js");
}
