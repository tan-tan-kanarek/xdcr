
const XDCR = require('./index');

let xdcr = new XDCR({
    cbAdminUrl: 'http://localhost:8091',
    cbAdminUsername: 'Administrator',
    cbAdminPassword: 'Administrator',
    hostname: '127.0.0.1',

    // optional:
    name: 'MyApp',
    adminPort: 9091,
    apiPort: 9092,
    username: 'Administrator',
    password: 'Administrator',
    configPath: './config/xdcr.json',
    // buckets: ['bucket1', 'bucket2'] // defaults to all buckets
})
.listen()
.on('error', (description, err) => {
    console.error(description, err);
})
.on('change', (key, value) => {
    console.log('change', key, value);
});
