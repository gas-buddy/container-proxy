var redbird = require('redbird');

var proxy = redbird({port: 9990});
proxy.register('http://localhost:9999', 'http://metralmacmini:5050');
