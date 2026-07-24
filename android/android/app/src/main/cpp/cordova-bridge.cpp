/*
  Node.js for Mobile Apps Cordova plugin.
  Implements the bridge APIs between the plugin and the Node.js engine.
 */
#define NAPI_VERSION 3
#include "node_api.h"
#include "uv.h"
#include "cordova-bridge.h"
#define NM_F_BUILTIN 0x1
#define NM_F_LINKED 0x2
#include <map>
#include <mutex>
#include <queue>
#include <string>
#include <cstring>
#include <cstdlib>

#define NAPI_RETVAL_NOTHING

#define GET_AND_THROW_LAST_ERROR(env)                                    \
  do {                                                                   \
    const napi_extended_error_info *error_info;                          \
    napi_get_last_error_info((env), &error_info);                        \
    bool is_pending;                                                     \
    napi_is_exception_pending((env), &is_pending);                       \
    if (!is_pending) {                                                   \
      const char* error_message = error_info->error_message != NULL ?    \
        error_info->error_message :                                      \
        "empty error message";                                           \
      napi_throw_error((env), NULL, error_message);                      \
    }                                                                    \
  } while (0)

#define NAPI_ASSERT_BASE(env, assertion, message, ret_val)               \
  do {                                                                   \
    if (!(assertion)) {                                                  \
      napi_throw_error(                                                  \
          (env),                                                         \
          NULL,                                                          \
          "assertion (" #assertion ") failed: " message);                \
      return ret_val;                                                    \
    }                                                                    \
  } while (0)

#define NAPI_ASSERT(env, assertion, message)                             \
  NAPI_ASSERT_BASE(env, assertion, message, NULL)

#define NAPI_ASSERT_RETURN_VOID(env, assertion, message)                 \
  NAPI_ASSERT_BASE(env, assertion, message, NAPI_RETVAL_NOTHING)

#define NAPI_CALL_BASE(env, the_call, ret_val)                           \
  do {                                                                   \
    if ((the_call) != napi_ok) {                                         \
      GET_AND_THROW_LAST_ERROR((env));                                   \
      return ret_val;                                                    \
    }                                                                    \
  } while (0)

#define NAPI_CALL(env, the_call)                                         \
  NAPI_CALL_BASE(env, the_call, NULL)

#define NAPI_CALL_RETURN_VOID(env, the_call)                             \
  NAPI_CALL_BASE(env, the_call, NAPI_RETVAL_NOTHING)

/**
 * Forward declarations
 */
void FlushMessageQueue(uv_async_t* handle);
class Channel;

/**
 * Global variables
 */
std::mutex channelsMutex;
std::map<std::string, Channel*> channels;

t_bridge_callback cordova_callback = NULL;

void RegisterBridgeCallback(t_bridge_callback callback) {
  cordova_callback = callback;
}

char* datadir_path = NULL;
void RegisterNodeDataDirPath(const char* path) {
  size_t pathLength = strlen(path);
  datadir_path = (char*)calloc(sizeof(char), pathLength + 1);
  strncpy(datadir_path, path, pathLength);
}

/**
 * Channel class
 */
class Channel {
  private:
    napi_env env = NULL;
    napi_ref function_ref = NULL;
    uv_async_t* queue_uv_handle = NULL;
    std::mutex uvhandleMutex;
    std::mutex queueMutex;
    std::queue<char*> messageQueue;
    std::string name;
    bool initialized = false;

  public:
    Channel(std::string name) : name(name) {};

    void setNapiRefs(napi_env& env, napi_ref& function_ref) {
      this->uvhandleMutex.lock();
      if (this->queue_uv_handle == NULL) {
        this->env = env;
        this->function_ref = function_ref;

        this->queue_uv_handle = (uv_async_t*)malloc(sizeof(uv_async_t));
        uv_async_init(uv_default_loop(), this->queue_uv_handle, FlushMessageQueue);
        this->queue_uv_handle->data = (void*)this;
        initialized = true;
        uv_async_send(this->queue_uv_handle);
      } else {
        napi_throw_error(env, NULL, "Channel already exists.");
      }
      this->uvhandleMutex.unlock();
    };

    void queueMessage(char* msg) {
      this->queueMutex.lock();
      this->messageQueue.push(msg);
      this->queueMutex.unlock();

      if (initialized) {
        uv_async_send(this->queue_uv_handle);
      }
    };

    void flushQueue() {
      char* message = NULL;
      bool empty = true;

      this->queueMutex.lock();
      if (!(this->messageQueue.empty())) {
        message = this->messageQueue.front();
        this->messageQueue.pop();
        empty = this->messageQueue.empty();
      }
      this->queueMutex.unlock();

      if (message != NULL) {
        this->invokeNodeListener(message);
        free(message);
      }

      if (!empty) {
        uv_async_send(this->queue_uv_handle);
      }
    };

    void invokeNodeListener(char* msg) {
      napi_handle_scope scope;
      napi_open_handle_scope(this->env, &scope);

      napi_value node_function;
      napi_get_reference_value(this->env, this->function_ref, &node_function);
      napi_value global;
      napi_get_global(this->env, &global);

      napi_value channel_name;
      napi_create_string_utf8(this->env, this->name.c_str(), this->name.size(), &channel_name);

      napi_value message;
      napi_create_string_utf8(this->env, msg, strlen(msg), &message);

      size_t argc = 2;
      napi_value argv[argc];
      argv[0] = channel_name;
      argv[1] = message;

      napi_value result;
      napi_call_function(this->env, global, node_function, argc, argv, &result);
      napi_close_handle_scope(this->env, scope);
    };
};

Channel* GetOrCreateChannel(std::string channelName) {
  channelsMutex.lock();
  Channel* channel = NULL;
  auto it = channels.find(channelName);
  if (it != channels.end()) {
    channel = it->second;
  } else {
    channel = new Channel(channelName);
    channels[channelName] = channel;
  }
  channelsMutex.unlock();
  return channel;
};

void FlushMessageQueue(uv_async_t* handle) {
  Channel* channel = (Channel*)handle->data;
  channel->flushQueue();
}

napi_value Method_RegisterChannel(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[argc];
  NAPI_CALL(env, napi_get_cb_info(env, info, &argc, args, NULL, NULL));
  NAPI_ASSERT(env, argc == 2, "Wrong number of arguments.");

  napi_value channel_name = args[0];
  napi_valuetype valuetype0;
  NAPI_CALL(env, napi_typeof(env, channel_name, &valuetype0));
  NAPI_ASSERT(env, valuetype0 == napi_string, "Expected a string.");

  size_t length;
  size_t length_copied;
  NAPI_CALL(env, napi_get_value_string_utf8(env, channel_name, NULL, 0, &length));

  std::unique_ptr<char[]> unique_channelname_buf(new char[length + 1]());
  char* channel_name_utf8 = unique_channelname_buf.get();
  NAPI_CALL(env, napi_get_value_string_utf8(env, channel_name, channel_name_utf8, length + 1, &length_copied));
  NAPI_ASSERT(env, length_copied == length, "Couldn't fully copy the channel name.");

  napi_value listener_function = args[1];
  napi_valuetype valuetype1;
  NAPI_CALL(env, napi_typeof(env, listener_function, &valuetype1));
  NAPI_ASSERT(env, valuetype1 == napi_function, "Expected a function.");

  napi_ref ref_to_function;
  NAPI_CALL(env, napi_create_reference(env, listener_function, 1, &ref_to_function));

  Channel* channel = GetOrCreateChannel(channel_name_utf8);
  channel->setNapiRefs(env, ref_to_function);
  return nullptr;
}

napi_value Method_SendMessage(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[argc];

  NAPI_CALL(env, napi_get_cb_info(env, info, &argc, args, NULL, NULL));
  NAPI_ASSERT(env, argc == 2, "Wrong number of arguments.");

  napi_value channel_name = args[0];
  napi_valuetype valuetype0;
  NAPI_CALL(env, napi_typeof(env, channel_name, &valuetype0));
  NAPI_ASSERT(env, valuetype0 == napi_string, "Expected a string.");

  size_t length;
  size_t length_copied;
  NAPI_CALL(env, napi_get_value_string_utf8(env, channel_name, NULL, 0, &length));
  std::unique_ptr<char[]> unique_channelname_buf(new char[length + 1]());
  char* channel_name_utf8 = unique_channelname_buf.get();
  NAPI_CALL(env, napi_get_value_string_utf8(env, channel_name, channel_name_utf8, length + 1, &length_copied));
  NAPI_ASSERT(env, length_copied == length, "Couldn't fully copy the channel name.");

  napi_value message = args[1];
  napi_valuetype valuetype1;
  NAPI_CALL(env, napi_typeof(env, message, &valuetype1));
  if (valuetype1 != napi_string) {
    NAPI_CALL(env, napi_coerce_to_string(env, message, &message));
  }

  length = length_copied = 0;
  NAPI_CALL(env, napi_get_value_string_utf8(env, message, NULL, 0, &length));
  std::unique_ptr<char[]> unique_msg_buf(new char[length + 1]());
  char* msg_buf = unique_msg_buf.get();
  NAPI_CALL(env, napi_get_value_string_utf8(env, message, msg_buf, length + 1, &length_copied));
  NAPI_ASSERT(env, length_copied == length, "Couldn't fully copy the message.");

  NAPI_ASSERT(env, cordova_callback, "No callback is set in native code to receive the message.");
  if (cordova_callback) {
    cordova_callback(channel_name_utf8, msg_buf);
  }
  return nullptr;
}

napi_value Method_GetDataDir(napi_env env, napi_callback_info info) {
  NAPI_ASSERT(env, datadir_path!=NULL, "Data directory not set from native side.");
  napi_value return_datadir;
  size_t str_len = strlen(datadir_path);
  NAPI_CALL(env, napi_create_string_utf8(env, datadir_path, str_len, &return_datadir));
  return return_datadir;
}

#define DECLARE_NAPI_METHOD(name, func) { name, 0, func, 0, 0, 0, napi_default, 0 }

napi_value Init(napi_env env, napi_value exports) {
  napi_status status;
  napi_property_descriptor properties[] = {
      DECLARE_NAPI_METHOD("sendMessage", Method_SendMessage),
      DECLARE_NAPI_METHOD("registerChannel", Method_RegisterChannel),
      DECLARE_NAPI_METHOD("getDataDir", Method_GetDataDir),
  };
  NAPI_CALL(env, napi_define_properties(env, exports, sizeof(properties) / sizeof(*properties), properties));
  return exports;
}

void SendMessageToNodeChannel(const char* channelName, const char* message) {
  size_t messageLength = strlen(message);
  char* messageCopy = (char*)calloc(sizeof(char), messageLength + 1);
  strncpy(messageCopy, message, messageLength);

  Channel* channel = GetOrCreateChannel(std::string(channelName));
  channel->queueMessage(messageCopy);
}

// Register the native module at libnode startup
NAPI_MODULE_X(cordova_bridge, Init, NULL, NM_F_LINKED)
