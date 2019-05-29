'use strict';
// https://github.com/ndlib/esu-cloudformation/blob/master/lambda-edge-utils/default-directory-index.js
exports.handler = (event, context, callback) => {
    var request = event.Records[0].cf.request;
    var olduri = request.uri;
    // Add a trailing slash to a sub path if there is none. Anything without a
    // '.' in the last part of the URI is considered a sub path.
    var newuri = olduri.replace(/^.*\/([^.|^\/]+)$/, olduri + '/');
    // Append index.html to any request with a trailing slash
    request.uri = newuri;
    return callback(null, request);
}
