
# XDCR
This package connects to couchbase as a cluster and raise events on any data change that triggered by couchbase server.

## Example
```js
const XDCR = require('xdcr');

let xdcr = new XDCR({
    cbAdminUrl: 'http://cb:8091',
    cbAdminUsername: 'Administrator',
    cbAdminPassword: 'Administrator',
    hostname: '127.0.0.1',

    // optional:
    name: 'MyApp',
    adminPort: 8091,
    apiPort: 8092,
    username: 'Administrator',
    password: 'Administrator',
    configPath: './config/xdcr.json',
    buckets: ['bucket1', 'bucket2'] // defaults to all buckets
})
.listen()
.on('error', (description, err) => {
    console.error(description, err);
})
.on('change', (key, value) => {
    console.log('change', key, value);
});
```

**cbAdminUrl** - URL of couchbase admin.

**cbAdminUsername** - Couchbase username

**cbAdminPassword** - Couchbase password

**hostname** - Application hostname to be used by couchbase server to access the application.

**name** - Application name.
The application will register as cluster in that name in couchbase server.

**adminPort** - The port to be used by the application for admin API, defaults to 8091.

**apiPort** - The port to be used by the application for API, defaults to 8092.

**username** - The port to be username by the application. If not supplied, no authorization will be validated.

**password** - The port to be password by the application. If not supplied, no authorization will be validated.

**configPath**: Path to save generated uuid.
Note that the configuration path is important in case you want to control whrere the file will be written, but there is no need to create the file, just specify where you want it to be saved.

**buckets** - Buckets to follow, defaults to all buckets.


## API

### unregister()
Unregisters the xdcr from couchbase server.

### listen()
Starts listening to events that triggered from couchbase server.
If the xdcr is not registered yet, it will be registered automatically.

### disconnect()
Stops listening to events from couchbase server.

### unref()
Won't prevent from program to exit.
