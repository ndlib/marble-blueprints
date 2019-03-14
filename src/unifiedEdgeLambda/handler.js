'use strict';

const pathMatches = new RegExp('^\/static|\/favicon.ico|\/robots.txt|\/sitemap.xml')

exports.handler = (event, context, callback) => {
  let request = event.Records[0].cf.request;

  request.uri = exports.modifyRequestUri(request.uri)
  callback(null, request)
  return
}

exports.modifyRequestUri = (uri) => {
  if (pathMatches.test(uri)) {
    return uri
  } else {
    return "/index.html"
  }
}
