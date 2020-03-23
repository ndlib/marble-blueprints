'use strict';
const path = require('path');

// https://medium.com/radon-dev/redirection-on-cloudfront-with-lambda-edge-e72fd633603e
exports.handler = (event, context, callback) => {
  const { request } = event.Records[0].cf;

  const parsedPath = path.parse(request.uri);
  let newUri;

  // this is not the best way that this we may need to do an s3 head request to fully
  // detect if the file exists.
  let valid_extensions = ['.html', '.js', '.json', '.css', '.jpg', '.jpeg', '.png', '.ico', '.map', '.txt', '.kml', '.svg', '.webmanifest', '.webp', '.xml', '.zip']
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
