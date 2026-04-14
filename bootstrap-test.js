const http = require('http');

const postData = JSON.stringify({
    bootstrapKey: 'JTiad1992!',
    email: 'jenel.tiad@deped.gov.ph',
    fullName: 'Jenel Tiad'
});

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/it-bootstrap',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    }
};

const req = http.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    console.log(`Headers:`, res.headers);

    res.setEncoding('utf8');
    let body = '';
    res.on('data', (chunk) => {
        body += chunk;
    });
    res.on('end', () => {
        console.log('Response:', body);
    });
});

req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
});

req.write(postData);
req.end();