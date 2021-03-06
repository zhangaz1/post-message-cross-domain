// Derived from https://github.com/umdjs/umd/blob/master/templates/amdWebGlobal.js
(function (root, factory) {
  var exports = {};
  factory(exports);

  if (typeof define === 'function' && define.amd) {
    // AMD
    define('Penpal', exports.default);
  } else {
    // Browser global
    root.Penpal = exports.default;
  }
}(this, function (exports) {

'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
var HANDSHAKE = 'handshake';
var HANDSHAKE_REPLY = 'handshake-reply';
var CALL = 'call';
var REPLY = 'reply';
var FULFILLED = 'fulfilled';
var REJECTED = 'rejected';
var MESSAGE = 'message';
var DATA_CLONE_ERROR = 'DataCloneError';

var ERR_CONNECTION_DESTROYED = exports.ERR_CONNECTION_DESTROYED = 'ConnectionDestroyed';
var ERR_CONNECTION_TIMEOUT = exports.ERR_CONNECTION_TIMEOUT = 'ConnectionTimeout';
var ERR_NOT_IN_IFRAME = exports.ERR_NOT_IN_IFRAME = 'NotInIframe';

var DEFAULT_PORTS = {
  'http:': '80',
  'https:': '443'
};

var URL_REGEX = /^(https?:)?\/\/([^\/:]+)(:(\d+))?/;

var Penpal = {
  ERR_CONNECTION_DESTROYED: ERR_CONNECTION_DESTROYED,
  ERR_CONNECTION_TIMEOUT: ERR_CONNECTION_TIMEOUT,
  ERR_NOT_IN_IFRAME: ERR_NOT_IN_IFRAME,

  /**
   * Promise implementation.
   * @type {Constructor}
   */
  Promise: function () {
    try {
      return window ? window.Promise : null;
    } catch (e) {
      return null;
    }
  }(),
  /**
   * Whether debug messages should be logged.
   * @type {boolean}
   */
  debug: false
};

/**
 * @return {number} A unique ID (not universally unique)
 */
var generateId = function () {
  var id = 0;
  return function () {
    return ++id;
  };
}();

/**
 * Logs a message.
 * @param {...*} args One or more items to log
 */
var log = function log() {
  for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
    args[_key] = arguments[_key];
  }

  if (Penpal.debug) {
    var _console;

    (_console = console).log.apply(_console, ['[Penpal]'].concat(args)); // eslint-disable-line no-console
  }
};

/**
 * Converts a URL into an origin.
 * @param {string} url
 * @return {string} The URL's origin
 */
var getOriginFromUrl = function getOriginFromUrl(url) {
  var location = document.location;

  var regexResult = URL_REGEX.exec(url);
  var protocol = void 0;
  var hostname = void 0;
  var port = void 0;

  if (regexResult) {
    // It's an absolute URL. Use the parsed info.
    // regexResult[1] will be undefined if the URL starts with //
    protocol = regexResult[1] ? regexResult[1] : location.protocol;
    hostname = regexResult[2];
    port = regexResult[4];
  } else {
    // It's a relative path. Use the current location's info.
    protocol = location.protocol;
    hostname = location.hostname;
    port = location.port;
  }

  // If the port is the default for the protocol, we don't want to add it to the origin string
  // or it won't match the message's event.origin.
  var portSuffix = port && port !== DEFAULT_PORTS[protocol] ? ':' + port : '';
  return protocol + '//' + hostname + portSuffix;
};

/**
 * A simplified promise class only used internally for when destroy() is called. This is
 * used to destroy connections synchronously while promises typically resolve asynchronously.
 *
 * @param {Function} executor
 * @returns {Object}
 * @constructor
 */
var DestructionPromise = function DestructionPromise(executor) {
  var handlers = [];

  executor(function () {
    handlers.forEach(function (handler) {
      handler();
    });
  });

  return {
    then: function then(handler) {
      handlers.push(handler);
    }
  };
};

/**
 * Converts an error object into a plain object.
 * @param {Error} Error object.
 * @returns {Object}
 */
var serializeError = function serializeError(_ref) {
  var name = _ref.name,
      message = _ref.message,
      stack = _ref.stack;
  return { name: name, message: message, stack: stack };
};

/**
 * Converts a plain object into an error object.
 * @param {Object} Object with error properties.
 * @returns {Error}
 */
var deserializeError = function deserializeError(obj) {
  var deserializedError = new Error();
  Object.keys(obj).forEach(function (key) {
    return deserializedError[key] = obj[key];
  });
  return deserializedError;
};

/**
 * Augments an object with methods that match those defined by the remote. When these methods are
 * called, a "call" message will be sent to the remote, the remote's corresponding method will be
 * executed, and the method's return value will be returned via a message.
 * @param {Object} callSender Sender object that should be augmented with methods.
 * @param {Object} info Information about the local and remote windows.
 * @param {Array} methodNames Names of methods available to be called on the remote.
 * @param {Promise} destructionPromise A promise resolved when destroy() is called on the penpal
 * connection.
 * @returns {Object} The call sender object with methods that may be called.
 */
var connectCallSender = function connectCallSender(callSender, info, methodNames, destructionPromise) {
  var localName = info.localName,
      local = info.local,
      remote = info.remote,
      remoteOrigin = info.remoteOrigin;

  var destroyed = false;

  log(localName + ': Connecting call sender');

  var createMethodProxy = function createMethodProxy(methodName) {
    return function () {
      for (var _len2 = arguments.length, args = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
        args[_key2] = arguments[_key2];
      }

      log(localName + ': Sending ' + methodName + '() call');

      if (destroyed) {
        var error = new Error('Unable to send ' + methodName + '() call due ' + 'to destroyed connection');
        error.code = ERR_CONNECTION_DESTROYED;
        throw error;
      }

      return new Penpal.Promise(function (resolve, reject) {
        var id = generateId();
        var handleMessageEvent = function handleMessageEvent(event) {
          if (event.source === remote && event.origin === remoteOrigin && event.data.penpal === REPLY && event.data.id === id) {
            log(localName + ': Received ' + methodName + '() reply');
            local.removeEventListener(MESSAGE, handleMessageEvent);

            var returnValue = event.data.returnValue;

            if (event.data.returnValueIsError) {
              returnValue = deserializeError(returnValue);
            }

            (event.data.resolution === FULFILLED ? resolve : reject)(returnValue);
          }
        };

        local.addEventListener(MESSAGE, handleMessageEvent);
        remote.postMessage({
          penpal: CALL,
          id: id,
          methodName: methodName,
          args: args
        }, remoteOrigin);
      });
    };
  };

  destructionPromise.then(function () {
    destroyed = true;
  });

  methodNames.reduce(function (api, methodName) {
    api[methodName] = createMethodProxy(methodName);
    return api;
  }, callSender);
};

/**
 * Listens for "call" messages coming from the remote, executes the corresponding method, and
 * responds with the return value.
 * @param {Object} info Information about the local and remote windows.
 * @param {Object} methods The keys are the names of the methods that can be called by the remote
 * while the values are the method functions.
 * @param {Promise} destructionPromise A promise resolved when destroy() is called on the penpal
 * connection.
 * @returns {Function} A function that may be called to disconnect the receiver.
 */
var connectCallReceiver = function connectCallReceiver(info, methods, destructionPromise) {
  var localName = info.localName,
      local = info.local,
      remote = info.remote,
      remoteOrigin = info.remoteOrigin;

  var destroyed = false;

  log(localName + ': Connecting call receiver');

  var handleMessageEvent = function handleMessageEvent(event) {
    if (event.source === remote && event.origin === remoteOrigin && event.data.penpal === CALL) {
      var _event$data = event.data,
          methodName = _event$data.methodName,
          args = _event$data.args,
          id = _event$data.id;


      log(localName + ': Received ' + methodName + '() call');

      if (methodName in methods) {
        var createPromiseHandler = function createPromiseHandler(resolution) {
          return function (returnValue) {
            log(localName + ': Sending ' + methodName + '() reply');

            if (destroyed) {
              // It's possible to throw an error here, but it would need to be thrown asynchronously
              // and would only be catchable using window.onerror. This is because the consumer
              // is merely returning a value from their method and not calling any function
              // that they could wrap in a try-catch. Even if the consumer were to catch the error,
              // the value of doing so is questionable. Instead, we'll just log a message.
              log(localName + ': Unable to send ' + methodName + '() reply due to destroyed connection');
              return;
            }

            var message = {
              penpal: REPLY,
              id: id,
              resolution: resolution,
              returnValue: returnValue
            };

            if (resolution === REJECTED && returnValue instanceof Error) {
              message.returnValue = serializeError(returnValue);
              message.returnValueIsError = true;
            }

            try {
              remote.postMessage(message, remoteOrigin);
            } catch (err) {
              // If a consumer attempts to send an object that's not cloneable (e.g., window),
              // we want to ensure the receiver's promise gets rejected.
              if (err.name === DATA_CLONE_ERROR) {
                remote.postMessage({
                  penpal: REPLY,
                  id: id,
                  resolution: REJECTED,
                  returnValue: serializeError(err),
                  returnValueIsError: true
                }, remoteOrigin);
              }

              throw err;
            }
          };
        };

        new Penpal.Promise(function (resolve) {
          return resolve(methods[methodName].apply(methods, args));
        }).then(createPromiseHandler(FULFILLED), createPromiseHandler(REJECTED));
      }
    }
  };

  local.addEventListener(MESSAGE, handleMessageEvent);

  destructionPromise.then(function () {
    destroyed = true;
    local.removeEventListener(MESSAGE, handleMessageEvent);
  });
};

/**
 * @typedef {Object} Child
 * @property {Promise} promise A promise which will be resolved once a connection has
 * been established.
 * @property {HTMLIframeElement} iframe The created iframe element.
 * @property {Function} destroy A method that, when called, will remove the iframe element from
 * the DOM and clean up event listeners.
 */

/**
 * Creates an iframe, loads a webpage into the URL, and attempts to establish communication with
 * the iframe.
 * @param {Object} options
 * @param {string} options.url The URL of the webpage that should be loaded into the created iframe.
 * @param {HTMLElement} [options.appendTo] The container to which the iframe should be appended.
 * @param {Object} [options.methods={}] Methods that may be called by the iframe.
 * @param {Number} [options.timeout] The amount of time, in milliseconds, Penpal should wait
 * for the child to respond before rejecting the connection promise.
 * @return {Child}
 */
Penpal.connectToChild = function (_ref2) {
  var url = _ref2.url,
      appendTo = _ref2.appendTo,
      _ref2$methods = _ref2.methods,
      methods = _ref2$methods === undefined ? {} : _ref2$methods,
      timeout = _ref2.timeout;

  var destroy = void 0;
  var connectionDestructionPromise = new DestructionPromise(function (resolveConnectionDestructionPromise) {
    destroy = resolveConnectionDestructionPromise;
  });

  var parent = window;
  var iframe = document.createElement('iframe');

  (appendTo || document.body).appendChild(iframe);

  connectionDestructionPromise.then(function () {
    if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  });

  var child = iframe.contentWindow || iframe.contentDocument.parentWindow;
  var childOrigin = getOriginFromUrl(url);
  var promise = new Penpal.Promise(function (resolveConnectionPromise, reject) {
    var connectionTimeoutId = void 0;

    if (timeout !== undefined) {
      connectionTimeoutId = setTimeout(function () {
        var error = new Error('Connection to child timed out after ' + timeout + 'ms');
        error.code = ERR_CONNECTION_TIMEOUT;
        reject(error);
        destroy();
      }, timeout);
    }

    // We resolve the promise with the call sender. If the child reconnects (for example, after
    // refreshing or navigating to another page that uses Penpal, we'll update the call sender
    // with methods that match the latest provided by the child.
    var callSender = {};
    var receiverMethodNames = void 0;

    var destroyCallReceiver = void 0;

    var handleMessage = function handleMessage(event) {
      if (event.source === child && event.origin === childOrigin && event.data.penpal === HANDSHAKE) {
        log('Parent: Received handshake, sending reply');

        event.source.postMessage({
          penpal: HANDSHAKE_REPLY,
          methodNames: Object.keys(methods)
        }, event.origin);

        var info = {
          localName: 'Parent',
          local: parent,
          remote: child,
          remoteOrigin: event.origin
        };

        // If the child reconnected, we need to destroy the previous call receiver before setting
        // up a new one.
        if (destroyCallReceiver) {
          destroyCallReceiver();
        }

        // When this promise is resolved, it will destroy the call receiver (stop listening to
        // method calls from the child) and delete its methods off the call sender.
        var callReceiverDestructionPromise = new DestructionPromise(function (resolveCallReceiverDestructionPromise) {
          connectionDestructionPromise.then(resolveCallReceiverDestructionPromise);
          destroyCallReceiver = resolveCallReceiverDestructionPromise;
        });

        connectCallReceiver(info, methods, callReceiverDestructionPromise);

        // If the child reconnected, we need to remove the methods from the previous call receiver
        // off the sender.
        if (receiverMethodNames) {
          receiverMethodNames.forEach(function (receiverMethodName) {
            delete callSender[receiverMethodName];
          });
        }

        receiverMethodNames = event.data.methodNames;
        connectCallSender(callSender, info, receiverMethodNames, connectionDestructionPromise);
        clearTimeout(connectionTimeoutId);
        resolveConnectionPromise(callSender);
      }
    };

    parent.addEventListener(MESSAGE, handleMessage);
    connectionDestructionPromise.then(function () {
      parent.removeEventListener(MESSAGE, handleMessage);

      var error = new Error('Connection destroyed');
      error.code = ERR_CONNECTION_DESTROYED;
      reject(error);
    });

    log('Parent: Loading iframe');
    iframe.src = url;
  });

  return {
    promise: promise,
    iframe: iframe,
    destroy: destroy
  };
};

/**
 * @typedef {Object} Parent
 * @property {Promise} promise A promise which will be resolved once a connection has
 * been established.
 */

/**
 * Attempts to establish communication with the parent window.
 * @param {Object} options
 * @param {string} [options.parentOrigin=*] Valid parent origin used to restrict communication.
 * @param {Object} [options.methods={}] Methods that may be called by the parent window.
 * @param {Number} [options.timeout] The amount of time, in milliseconds, Penpal should wait
 * for the parent to respond before rejecting the connection promise.
 * @return {Parent}
 */
Penpal.connectToParent = function () {
  var _ref3 = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
      _ref3$parentOrigin = _ref3.parentOrigin,
      parentOrigin = _ref3$parentOrigin === undefined ? '*' : _ref3$parentOrigin,
      _ref3$methods = _ref3.methods,
      methods = _ref3$methods === undefined ? {} : _ref3$methods,
      timeout = _ref3.timeout;

  if (window === window.top) {
    var error = new Error('connectToParent() must be called within an iframe');
    error.code = ERR_NOT_IN_IFRAME;
    throw error;
  }

  var destroy = void 0;
  var connectionDestructionPromise = new DestructionPromise(function (resolveConnectionDestructionPromise) {
    destroy = resolveConnectionDestructionPromise;
  });

  var child = window;
  var parent = child.parent;

  var promise = new Penpal.Promise(function (resolveConnectionPromise, reject) {
    var connectionTimeoutId = void 0;

    if (timeout !== undefined) {
      connectionTimeoutId = setTimeout(function () {
        var error = new Error('Connection to parent timed out after ' + timeout + 'ms');
        error.code = ERR_CONNECTION_TIMEOUT;
        reject(error);
        destroy();
      }, timeout);
    }

    var handleMessageEvent = function handleMessageEvent(event) {
      if ((parentOrigin === '*' || parentOrigin === event.origin) && event.source === parent && event.data.penpal === HANDSHAKE_REPLY) {
        log('Child: Received handshake reply');

        child.removeEventListener(MESSAGE, handleMessageEvent);

        var info = {
          localName: 'Child',
          local: child,
          remote: parent,
          remoteOrigin: event.origin
        };

        var callSender = {};

        connectCallReceiver(info, methods, connectionDestructionPromise);
        connectCallSender(callSender, info, event.data.methodNames, connectionDestructionPromise);
        clearTimeout(connectionTimeoutId);
        resolveConnectionPromise(callSender);
      }
    };

    child.addEventListener(MESSAGE, handleMessageEvent);

    connectionDestructionPromise.then(function () {
      child.removeEventListener(MESSAGE, handleMessageEvent);

      var error = new Error('Connection destroyed');
      error.code = ERR_CONNECTION_DESTROYED;
      reject(error);
    });

    log('Child: Sending handshake');

    parent.postMessage({
      penpal: HANDSHAKE,
      methodNames: Object.keys(methods)
    }, parentOrigin);
  });

  return {
    promise: promise,
    destroy: destroy
  };
};

exports.default = Penpal;

}));
