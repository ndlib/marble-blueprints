// To run this
// yarn run jest handler.test.js
//
const test_handler = require('./handler').handler

// Function to make it easier to create test event objects
// to send to the test handler. Returns a cloudfront origin
// event object with the given uri.
describe('URL ReWrites', () => {
  var new_test_event = (uri) => ({
    Records: [
      {
        cf: {
          response: {
            status: 200,
          },
          request: {
            uri: uri,
          }
        }
      }
    ]
  })

  // Array of requested URIs and what we expect the function to rewrite it to
  var test_uris = [
    { test_uri: '', expected_uri: 'index.html' },
    { test_uri: '/', expected_uri: '/index.html' },
    { test_uri: '/sub_path', expected_uri: '/sub_path/index.html' },
    { test_uri: '/sub_path/', expected_uri: '/sub_path/index.html' },
    { test_uri: '/sub_path/sub_path', expected_uri: '/sub_path/sub_path/index.html' },
    { test_uri: '/sub_path/sub_path/', expected_uri: '/sub_path/sub_path/index.html' },
    { test_uri: '/page.html', expected_uri: '/page.html' },
    { test_uri: '/sub.path', expected_uri: '/sub.path/index.html' },
    { test_uri: '/1999.024', expected_uri: '/1999.024/index.html' },
    { test_uri: '/1239.024.534', expected_uri: '/1239.024.534/index.html' },
    { test_uri: '/image.avif', expected_uri: '/image.avif' },
    { test_uri: '/user/jhartzle', expected_uri: '/index.html' },
    { test_uri: '/myportfolio/blabasldfasgw-werw', expected_uri: '/index.html' },
  ]

  // Loop through each of the test URIs and make sure the function under test rewrites
  // the request correctly
  test_uris.forEach((test_obj) => {
    test('when URI "' + test_obj.test_uri + '" is requested, rewrites to: "' +test_obj.expected_uri + '"', () => {
      var test_event = new_test_event(test_obj.test_uri)
      // When AWS executes a Lambda, it passes in a callback function to your handler. It
      // expects your handler to call the passed in function with the resultant data.
      // This is a mock callback that we'll pass to the handler we are testing so that we can
      // simulate what will happen when deployed. This mock function is where we inspect
      // the data that the handler will ultimately be returned to Cloudfront.
      const mock_callback = (err, data) => {
        expect(data).toEqual({ uri : test_obj.expected_uri })
      }
      test_handler(test_event, null, mock_callback)
    })
  })
})
