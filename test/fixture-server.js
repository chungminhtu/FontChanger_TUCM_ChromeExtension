// Catch-all static server: any path returns the fixture (so /home and
// /user/status/ID both load it), except the CSS + test script assets.
const http = require('http');
const fs = require('fs');
const DIR = '/private/tmp/claude-501/-Volumes-DATA-TUCM-FontChanger-TUCM-ChromeExtension/2469f2b4-7a4a-4336-bfc1-25bb70ea0877/scratchpad';
const REAL_CSS = '/Volumes/DATA/TUCM/FontChanger_TUCM_ChromeExtension/src/content/x.css';

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url.endsWith('x.css')) {
    res.writeHead(200, { 'content-type': 'text/css' });
    res.end(fs.readFileSync(REAL_CSS));
  } else if (url.endsWith('x-masonry.test.js')) {
    res.writeHead(200, { 'content-type': 'application/javascript' });
    res.end(fs.readFileSync(DIR + '/x-masonry.test.js'));
  } else {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(fs.readFileSync(DIR + '/fixture.html'));
  }
});
server.listen(8099, () => console.log('server on http://localhost:8099'));
