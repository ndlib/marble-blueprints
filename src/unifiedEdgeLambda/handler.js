'use strict';

const pathMatches = [/^\/static/, /\/favicon.ico/, /\/robots.txt/, /\/sitemap.xml/]

exports.handler = (event, context, callback) => {
  let request = event.Records[0].cf.request;

  request.uri = exports.modifyRequestUri(request.uri)
  callback(null, request)
  return
}

exports.modifyRequestUri = (uri) => {
  for(let expr of pathMatches) {
    if (expr.test(uri)) {
       return uri
       return
    }
  }

  return "/index.html";
}
