cmake_minimum_required(VERSION 3.4.1)

add_library(
    nodejs-mobile-cordova-native-lib
    SHARED
    native-lib.cpp
    cordova-bridge.cpp
)

include_directories(libnode/include/node/)

add_library(
    libnode
    SHARED
    IMPORTED
)
set_target_properties(
    libnode
    PROPERTIES IMPORTED_LOCATION
    ${CMAKE_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libnode.so
)

find_library(log-lib log)

target_link_libraries(
    nodejs-mobile-cordova-native-lib
    libnode
    ${log-lib}
)
