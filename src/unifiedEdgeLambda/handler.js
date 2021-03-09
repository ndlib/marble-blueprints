'use strict';
const path = require('path');

// https://medium.com/radon-dev/redirection-on-cloudfront-with-lambda-edge-e72fd633603e
exports.handler = (event, context, callback) => {
  const { request } = event.Records[0].cf;

  const parsedPath = path.parse(request.uri);
  let newUri;

  const dynamicPaths = ['user', 'myportfolio'];
  if (dynamicPaths.includes(parsedPath.dir.split('/')[1])) {
    newUri = '/index.html';
    request.uri = newUri;
    return callback(null, request);
  }

  // this is not the best way that this we may need to do an s3 head request to fully
  // detect if the file exists.
  const valid_extensions = ['.html', '.js', '.json', '.css', '.jpg', '.jpeg', '.png', '.ico', '.map', '.txt', '.kml', '.svg', '.webmanifest', '.webp', '.xml', '.zip', '.avif'];
  // if there is no extension or it is not in one of the extensions we expect to find on the
  // server.
  if (parsedPath.ext == '' || !valid_extensions.includes(parsedPath.ext)) {
    newUri = path.join(parsedPath.dir, parsedPath.base, 'index.html');
  } else {
    newUri = request.uri;
  }

  // Replace the received URI with the URI that includes the index page
  request.uri = newUri;

  // Return to CloudFront
  return callback(null, request);
}
