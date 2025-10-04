import cluster from 'cluster';
import os from 'os';

const numCPUs = os.cpus().length;

if (cluster.isPrimary) {
  console.log(`Primary process ${process.pid} is running`);

  for (let i = 0; i < numCPUs; i++) {
    const worker = cluster.fork();

    // Tell the first worker to monitor
    if (i === 0) {
      worker.send({ type: 'start-monitoring' });
    }
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died`);
    const newWorker = cluster.fork();
    console.log(`Restarted worker ${newWorker.process.pid}`);
  });
} else {
  require('./server'); // Worker loads the app
}
