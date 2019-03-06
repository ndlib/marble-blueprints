const hander = require('./handler')

test('it passes on the static directory', () => {
  let tests = ['/static/index.js', '/static/js/2345235.chunk.js', '/static/js/main.246asgrt4.chunk.js']

  for(let test of tests) {
    expect(hander.modifyRequestUri(test)).toEqual(test)
  }
})

test("it allows the basic site files to be passed through", () => {
  let tests = ['/favicon.ico', '/robots.txt', '/sitemap.xml', '/index.html']

  for(let test of tests) {
    expect(hander.modifyRequestUri(test)).toEqual(test)
  }
})

test('other patterns are sent to the index.html', () => {
  let tests = ['/', '', '/some_path', '/item/2342432', 'robots', '404', '/directory/subdir']

  for(let test of tests) {
    expect(hander.modifyRequestUri(test)).toEqual('/index.html')
  }
})
