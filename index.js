
const fs = require('fs');
const os = require('os');
const url = require('url');
const path = require('path');
const http = require('http');
const udid = require('udid');
const Promise = require('bluebird');
const httpProxy = require('http-proxy');
const querystring = require('querystring');
const EventEmitter = require('events').EventEmitter;

class XDCR extends EventEmitter {
    constructor(options) {
        super();

        this.options = options;
        this.registered = false;
        this.remoteCluster = null;
        this.remotePool = null;
        this.remoteBuckets = {};
        this.remoteReplications = [];
        this.servers = [];

        this._init();
    }

    _init() {
        
        if(!this.options.name) {
            this.options.name = os.hostname();
        }
                
        if(!this.options.adminPort) {
            this.options.adminPort = 8091;
        }
        
        if(!this.options.apiPort) {
            this.options.apiPort = 8092;
        }
        
        if(!this.options.configPath) {
            this.options.configPath = './config/xdcr.json';
        }

        this.options.auth = 'Basic ' + new Buffer(this.options.username + ':' + this.options.password).toString('base64');

        this.config = {};        
        if(fs.existsSync(this.options.configPath)) {            
            const json = fs.readFileSync(this.options.configPath);
            this.config = JSON.parse(json);
        }
        
        if(!this.config.uuid) {
            this.config.uuid = this._generateUUID();
        }

        this._saveConfig();
    }

    _generateUUID() {
        let d = new Date();
        return udid(d.getTime()).substr(0, 32);
    }

    _saveConfig() {        
        let json = JSON.stringify(this.config, null, 4);
        let dirname = path.dirname(this.options.configPath);
        fs.exists(dirname, exists => {
            if(!exists) {
                fs.mkdirSync(dirname);
            }
            fs.writeFile(this.options.configPath, json, err => {
                if(err) {
                    this.emit('error', 'Failed to save configuration', err);
                }
            });
        });        
    }
   
    _getBucketConfig(bucketName) {
        if(!this.config.buckets) {
            this.config.buckets = {};
        }
        if(this.config.buckets[bucketName]) {
            return this.config.buckets[bucketName];
        }
        else {
            this.config.buckets[bucketName] = {
                uuid: this._generateUUID()
            }
        }
        this._saveConfig();
        return this.config.buckets[bucketName];
    }
    
    _getBody(req) {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', data => {             
                body += data;
            });
            req.on('end', () => {
                resolve(body);
            });
        });
    }

    _requestPools(req) {
		return Promise.resolve({
			status: 200, 
			json: {
				isAdminCreds: true,
				isROAdminCreds: false,
				isEnterprise: true,
				pools: [{
					name: 'default',
					uri: '/pools/default?uuid=' + this.config.uuid,
					streamingUri: '/poolsStreaming/default?uuid=' + this.config.uuid
				}],
				settings: {
					maxParallelIndexers: '/settings/maxParallelIndexers?uuid=' + this.config.uuid,
					viewUpdateDaemon: '/settings/viewUpdateDaemon?uuid=' + this.config.uuid
				},
				uuid: this.config.uuid
			}
		});
    }

    _requestPool(req, poolName) {
		return Promise.resolve({
			status: 200, 
			json: {
				name: poolName,
				alerts: [],
				nodes: [{
					couchApiBase: `http://${this.options.hostname}:${this.options.apiPort}/`,
					clusterMembership: 'active',
					recoveryType: 'none',
					status: 'healthy',
					thisNode: true,
					hostname: this.options.hostname + ':' + this.options.adminPort,
					ports: {
						sslProxy: 11214,
						httpsMgmt: 18091,
						httpsCAPI: 18092,
						proxy: 11211,
						direct: 11210
					},
					services: [
						"fts",
						"index",
						"kv",
						"n1ql"
					]
				}],
				buckets: {
					uri: `/pools/${poolName}/buckets?v=55074256&uuid=${this.config.uuid}`,
					terseBucketsBase: `/pools/${poolName}/b/`,
					terseStreamingBucketsBase: `/pools/${poolName}/bs/`
				},
				remoteClusters: {
					uri: `/pools/${poolName}/remoteClusters?uuid=${this.config.uuid}`,
					validateURI: `/pools/${poolName}/remoteClusters?just_validate=1`
				},
				controllers: {
					addNode: {
						uri: '/controller/addNodeV2?uuid=' + this.config.uuid
					},
					rebalance: {
						uri: '/controller/rebalance?uuid=' + this.config.uuid
					},
					failOver: {
						uri: '/controller/failOver?uuid=' + this.config.uuid
					},
					startGracefulFailover: {
						uri: '/controller/startGracefulFailover?uuid=' + this.config.uuid
					},
					reAddNode: {
						uri: '/controller/reAddNode?uuid=' + this.config.uuid
					},
					reFailOver: {
						uri: '/controller/reFailOver?uuid=' + this.config.uuid
					},
					ejectNode: {
						uri: '/controller/ejectNode?uuid=' + this.config.uuid
					},
					setRecoveryType: {
						uri: '/controller/setRecoveryType?uuid=' + this.config.uuid
					},
					setAutoCompaction: {
						uri: '/controller/setAutoCompaction?uuid=' + this.config.uuid,
						validateURI: '/controller/setAutoCompaction?just_validate=1'
					},
					clusterLogsCollection: {
						startURI: '/controller/startLogsCollection?uuid=' + this.config.uuid,
						cancelURI: '/controller/cancelLogsCollection?uuid=' + this.config.uuid
					},
					replication: {
						createURI: '/controller/createReplication?uuid=' + this.config.uuid,
						validateURI: '/controller/createReplication?just_validate=1'
					}
				},
				rebalanceStatus: 'none',
				rebalanceProgressUri: `/pools/${poolName}/rebalanceProgress`,
				stopRebalanceUri: '/controller/stopRebalance?uuid=' + this.config.uuid,
				nodeStatusesUri: '/nodeStatuses',
				clusterName: this.config.name,
				balanced: true
			}
		});
    }
    
    _requestBucket(req, poolName, bucketName) {
        let bucketConfig = this._getBucketConfig(bucketName);
        
		let vBucketMap = [];
		vBucketMap.length = 1024;
        vBucketMap.fill([0, -1]);
        
		return Promise.resolve({
			status: 200, 
			json: {
				name: bucketName,
				bucketType: "membase",
				authType: "none",
				uri: `/pools/default/buckets/${bucketName}?bucket_uuid=${bucketConfig.uuid}`,
				streamingUri: `/pools/default/bucketsStreaming/${bucketName}?bucket_uuid=${bucketConfig.uuid}`,
				localRandomKeyUri: `/pools/default/buckets/${bucketName}/localRandomKey`,
				controllers: {
					compactAll: `/pools/default/buckets/${bucketName}/controller/compactBucket`,
					compactDB: `/pools/default/buckets/${bucketName}/controller/compactDatabases`,
					purgeDeletes: `/pools/default/buckets/${bucketName}/controller/unsafePurgeBucket`,
					startRecovery: `/pools/default/buckets/${bucketName}/controller/startRecovery`
				},
				nodes: [{
					couchApiBase: `http://${this.options.hostname}:${this.options.apiPort}/${bucketName}%2B${bucketConfig.uuid}`,
					clusterMembership: 'active',
					recoveryType: 'none',
					status: 'healthy',
					thisNode: true,
					hostname: this.options.hostname + ':' + this.options.adminPort,
					ports: {
						sslProxy: 11214,
						httpsMgmt: 18091,
						httpsCAPI: 18092,
						proxy: 11211,
						direct: 11210
					},
					services: [
						"fts",
						"index",
						"kv",
						"n1ql"
					]
				}],
				stats: {
					uri: `/pools/default/buckets/${bucketName}/stats`,
					directoryURI: `/pools/default/buckets/${bucketName}/statsDirectory`,
					nodeStatsListURI: `/pools/default/buckets/${bucketName}/nodes`
				},
				nodeLocator: "vbucket",
				ddocs: {
					uri: `/pools/default/buckets/${bucketName}/ddocs`
				},
				replicaIndex: false,
				autoCompactionSettings: false,
				uuid: bucketConfig.uuid,
				vBucketServerMap: {
					hashAlgorithm: "CRC",
					numReplicas: 1,
					serverList: [this.options.hostname + ':11210'],
					vBucketMap: vBucketMap
				},
				replicaNumber: 1,
				threadsNumber: 3,
				evictionPolicy: "valueOnly",
				conflictResolutionType: "seqno",
				bucketCapabilitiesVer: "",
				bucketCapabilities: [
					"xattr",
					"dcp",
					"cbhello",
					"touch",
					"couchapi",
					"cccp",
					"xdcrCheckpointing",
					"nodesExt"
				]
			}
		});
    }
	
	_requestPreReplicate(req) {
		return new Promise((resolve, reject) => {
			this._getBody(req)
			.then(body => {
                // { 
                //     bucket: 'test123',
                //     bucketUUID: '5b20bb0044c9c426d9125321c8416fa7',
                //     vb: 1000 
                // }
                resolve({status: 200, json: {"vbopaque":174184100819342}});
			});			
		});
	}

	_requestMassVBopaqueCheck(req) {
		return new Promise((resolve, reject) => {
			this._getBody(req)
			.then(body => {
				let {vbopaques} = JSON.parse(body);
				resolve({
					status: 200, 
					json: {
						matched: vbopaques,
						mismatched: [],
						missing: []
					}
				});
			});	
		});	
	}

    _requestBulkDocs(req, bucketName, bucketId, x) {
		console.log(bucketName, bucketId, x);
		return new Promise((resolve, reject) => {
			this._getBody(req)
			.then(body => {
                let {docs} = JSON.parse(body);
                // {
                //     "new_edits": false,
                //     "docs": [
                //         {
                //             "base64": "eyJjbGljayI6ICJ0byBlZGl0IiwgIndpdGggSlNPTiI6ICJ0aGVyZSBhcmUgbm8gcmVzZXJ2ZWQgZmllbGQgbmFtZXMifQ==",
                //             "meta": {
                //                 "expiration": 0,
                //                 "flags": 33554438,
                //                 "id": "bbb",
                //                 "rev": "1-152147cd747000000000000002000006"
                //             }
                //         }
                //     ]
                // }
                docs.forEach(doc => this.emit('change', doc.meta.id, JSON.parse(Buffer.from(doc.base64, 'base64').toString('utf-8'))));
				resolve({
					status: 201, 
					json: {
						ok:true
					}
				});
			});	
		});	
    }

    _postRequest(requestUrl, expectedStatus, method, data) {
        if(!expectedStatus) {
            expectedStatus = 200;
        }
    
        if(method) {
            if(!data) {
                data = method;
                method = 'POST';
            }
        }
        else {
            method = 'GET';
        }
    
        let options = url.parse(requestUrl);
        options.method = method;
    
        let postData = data ? querystring.stringify(data) : null;
        options.headers = {
            'Authorization' : this.options.auth,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': postData ? postData.length : 0
        };
        console.log('Remote Request:', JSON.stringify({options: options, data: postData}, null, 4));
        return new Promise((resolve, reject) => {
            let req = http.request(options, res => {
                const { statusCode } = res;
                const contentType = res.headers['content-type'];
            
                res.setEncoding('utf8');
                let rawData = '';
                res.on('data', chunk => {
                    rawData += chunk;
                });
                res.on('end', () => {
                    console.log('Remote Response:', rawData);
                    let error;
                    if (statusCode !== expectedStatus) {
                        error = new Error(`Request Failed.\nStatus Code: ${statusCode}\n${rawData}`);
                    } else if (!/^application\/json/.test(contentType)) {
                        error = new Error(`Invalid content-type.\nExpected application/json but received ${contentType}\n${rawData}`);
                    }
                    if (error) {
                        reject(error);
                        return;
                    }
                    else {
                        try {
                            const json = JSON.parse(rawData);
                            resolve(json);
                        } catch (e) {
                            reject(e);
                        }
                    }
                });
            });
    
            if(postData) {
                req.write(postData);
            }
            req.end();
        });
    }

    _jsonRequest(requestUrl, expectedStatus, method, data) {
        if(!expectedStatus) {
            expectedStatus = 200;
        }
    
        if(method) {
            if(!data) {
                data = method;
                method = 'POST';
            }
        }
        else {
            method = 'GET';
        }
    
        let options = url.parse(requestUrl);
        options.method = method;
    
        let postData = data ? JSON.stringify(data) : null;
        options.headers = {
            'Authorization' : this.options.auth,
            'Content-Type': 'application/json',
            'Content-Length': postData ? postData.length : 0
        };
        console.log('Remote Request:', JSON.stringify({options: options, data: postData}, null, 4));
        return new Promise((resolve, reject) => {
            let req = http.request(options, res => {
                const { statusCode } = res;
                const contentType = res.headers['content-type'];
            
                res.setEncoding('utf8');
                let rawData = '';
                res.on('data', chunk => {
                    rawData += chunk;
                });
                res.on('end', () => {
                    console.log('Remote Response:', rawData);
                    let error;
                    if (statusCode !== expectedStatus) {
                        error = new Error(`Request Failed.\nStatus Code: ${statusCode}\n${rawData}`);
                    } else if (!/^application\/json/.test(contentType)) {
                        error = new Error(`Invalid content-type.\nExpected application/json but received ${contentType}\n${rawData}`);
                    }
                    if (error) {
                        reject(error);
                        return;
                    }
                    else {
                        try {
                            const json = JSON.parse(rawData);
                            resolve(json);
                        } catch (e) {
                            reject(e);
                        }
                    }
                });
            });
    
            if(postData) {
                req.write(postData);
            }
            req.end();
        });
    }
    
    _getRemotePools() {
        return new Promise((resolve, reject) => {
            this._postRequest(this.options.cbAdminUrl + '/pools')
            .then(json => {
                this.remoteCluster = json;
                resolve(this.remoteCluster);
            }, err => {
                this.emit('error', 'Failed to connect cluster', err);
                reject(err);
            })
        });
    }
    
    _getRemotePool() {
        return new Promise((resolve, reject) => {
            this._postRequest(this.options.cbAdminUrl + this.remoteCluster.pools[0].uri)
            .then(json => {
                this.remotePool = json;
                resolve(this.remotePool);
            }, err => {
                this.emit('error', 'Failed to get pool', err);
                reject(err);
            })
        });
    }
    
    _getRemoteClusers() {
        return new Promise((resolve, reject) => {
            this._postRequest(this.options.cbAdminUrl + this.remotePool.remoteClusters.uri)
            .then(json => {
                resolve(json);
            }, err => {
                this.emit('error', 'Failed to get remote clusters', err);
                reject(err);
            })
        });
    }
    
    _getRemoteBuckets() {
        return new Promise((resolve, reject) => {
            this._postRequest(this.options.cbAdminUrl + this.remotePool.buckets.uri)
            .then(json => {
                this.remoteBuckets = {};
                for(let i = 0; i < json.length; i++) {
                    let bucket = json[i];
                    this.remoteBuckets[bucket.name] = bucket;
                }
                resolve(this.remoteBuckets);
            }, err => {
                this.emit('error', 'Failed to get remote buckets', err);
                reject(err);
            })
        });
    }
    
    _getRemoteReplications() {
        return new Promise((resolve, reject) => {
            this._postRequest(this.options.cbAdminUrl + this.remotePool.tasks.uri)
            .then(json => {
                this.remoteReplications = [];
                for(let i = 0; i < json.length; i++) {
                    let task = json[i];
                    if(task.type == 'xdcr' && task.id.startsWith(this.config.uuid)) {
                        this.remoteReplications.push(task.id.split('/').pop());
                    }
                }
                resolve(this.remoteBuckets);
            }, err => {
                this.emit('error', 'Failed to get remote buckets', err);
                reject(err);
            })
        });
    }
    
    _register() {
        return new Promise((resolve, reject) => {
            this._getRemotePools()
            .then(() => this._getRemotePool())
            .then(() => this._getRemoteClusers())
            .then(clusters => {
                if(clusters.find(cluster => cluster.name === this.options.name)) {
                    return Promise.resolve();
                }
                return this._postRequest(this.options.cbAdminUrl + this.remotePool.remoteClusters.uri, 200, {
                    uuid: this.config.uuid,
                    name: this.options.name,
                    hostname: this.options.hostname + ':' + this.options.adminPort,
                    username: this.options.username ? this.options.username : 'admin',	
                    password: this.options.password ? this.options.password : 'admin'
                });
            }, err => {
                this.emit('error', 'Failed to register as cluster', err);
                reject(err);
            })
            .then(() => this._getRemoteBuckets())
            .then(() => this._getRemoteReplications())
            .then(json => {
                let buckets;
                if(this.options.buckets && this.options.buckets.length) {
                    buckets = this.options.buckets;
                }
                else {
                    buckets = Object.keys(this.remoteBuckets);
                }
                console.log('buckets', buckets);
                buckets = buckets.filter(bucket => !this.remoteReplications.includes(bucket));
                console.log('remoteReplications', this.remoteReplications);
                console.log('buckets', buckets);
                if(!buckets.length) {
                    return Promise.resolve();
                }

                let promises = buckets.map(bucketName => this._postRequest(this.options.cbAdminUrl + this.remotePool.controllers.replication.validateURI, 200, {
                    fromBucket: bucketName,
                    toCluster: this.options.name,
                    toBucket: bucketName,
                    replicationType: 'continuous',
                    type: 'capi'
                }));                
                return Promise.all(promises);
            })
            .then((replications) => {
                resolve();
            }, err => {
                this.emit('error', 'Failed to create replication', err);
                reject(err);
            });
        });
    }

    unregister() {
    }

    _listen(port, handlers) {
        const server = http.createServer((req, res) => {
        
            let parseUrl = url.parse(req.url);
            let urlPath = parseUrl.path;
    
            let handler;
            let handlerArgs = [];
            if(handlers[urlPath]) {
                handler = handlers[urlPath];
            }
            else {
                for(let path in handlers) {
                    if(path.startsWith('^')) {
                        let regex = new RegExp(path);
                        let matches = regex.exec(urlPath);
                        if(matches) {
                            handler = handlers[path];
                            matches.shift();
                            handlerArgs = matches;
                            break;
                        }
                    }
                }
            }
            
            if(handler) {
                // console.log(req.method, req.url);
                handlerArgs.unshift(req);
                handler.apply(this, handlerArgs)
                .then(({status, json}) => {
                    // console.log(status, json);
                    let body = JSON.stringify(json);
                    res.writeHead(status, {
                        'Content-Type': 'application/json',
                        'Content-Length': body.length
                    });
                    res.write(body);
                    res.end();
                });
            }
            else {
                console.log(port, req.method, urlPath, req.headers);
                if(req.method == 'POST') {
                    this._getBody(req)
                    .then(body => {
                        console.log('Body:', body);
                    });
                }
            }
        });
        server.listen(port, () => {
            this.emit('listen', port);
        });
        this.servers.push(server);
    }

    listen() {
        this._listen(this.options.adminPort, {
            '/pools': this._requestPools,
            '^/pools/([^/]+)$': this._requestPool,
            '^/pools/([^/]+)/buckets/([^/]+)$': this._requestBucket
        });
        this._listen(this.options.apiPort, {
            '/_pre_replicate': this._requestPreReplicate,
            '/_mass_vbopaque_check': this._requestMassVBopaqueCheck,
            '^/([^%]+)%2B([^%]+)%2f(\\d+)/_bulk_docs': this._requestBulkDocs
        });
        
        if(!this.registered) {
            this._register()
            .catch(err => this.emit('error', 'Failed to register', err));
        }

        return this;
    }

    disconnect() {
        this.servers.forEach(server => server.close());
    }

    unref() {
        this.servers.forEach(server => server.unref());
    }
}

module.exports = XDCR;