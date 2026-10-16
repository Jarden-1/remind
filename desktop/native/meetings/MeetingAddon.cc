#include <node_api.h>
#include <string>

extern "C" char* remind_meeting_snapshot();
extern "C" void remind_meeting_free(char* value);
extern "C" void remind_meeting_self_test();

struct Scan {
  napi_async_work work;
  napi_deferred deferred;
  std::string result;
};

static void Execute(napi_env, void* data) {
  auto* scan = static_cast<Scan*>(data);
  char* value = remind_meeting_snapshot();
  if (value) { scan->result = value; remind_meeting_free(value); }
}

static void Complete(napi_env env, napi_status status, void* data) {
  auto* scan = static_cast<Scan*>(data);
  napi_value value;
  if (status == napi_ok && !scan->result.empty()) {
    napi_create_string_utf8(env, scan->result.c_str(), scan->result.size(), &value);
    napi_resolve_deferred(env, scan->deferred, value);
  } else {
    napi_value message;
    napi_create_string_utf8(env, "meeting_probe_failed", NAPI_AUTO_LENGTH, &message);
    napi_create_error(env, nullptr, message, &value);
    napi_reject_deferred(env, scan->deferred, value);
  }
  napi_delete_async_work(env, scan->work);
  delete scan;
}

static napi_value Observe(napi_env env, napi_callback_info) {
  auto* scan = new Scan();
  napi_value promise, name;
  napi_create_promise(env, &scan->deferred, &promise);
  napi_create_string_utf8(env, "remind-meeting-scan", NAPI_AUTO_LENGTH, &name);
  if (napi_create_async_work(env, nullptr, name, Execute, Complete, scan, &scan->work) != napi_ok) {
    delete scan;
    napi_throw_error(env, nullptr, "Cannot create meeting scan");
    return nullptr;
  }
  if (napi_queue_async_work(env, scan->work) != napi_ok) {
    napi_delete_async_work(env, scan->work);
    delete scan;
    napi_throw_error(env, nullptr, "Cannot queue meeting scan");
    return nullptr;
  }
  return promise;
}

static napi_value SelfTest(napi_env env, napi_callback_info) {
  remind_meeting_self_test();
  napi_value result;
  napi_get_boolean(env, true, &result);
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"observe", nullptr, Observe, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"selfTest", nullptr, SelfTest, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 2, methods);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
