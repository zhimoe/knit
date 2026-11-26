# Nimi's background IPC channel is unstable under ARC/ORC with Nim 2.4.2:
# repeated calls corrupt the heap (minimal repro: one background method called
# every 300 ms). refc deep-copies channel messages and is stable; revisit once
# the framework's sink/channel ownership is fixed. Registered in docs/03 §7.1.
--mm:refc
--threads:on

import std/strutils

when not defined(knitNoLibgit2):
  when defined(windows):
    let prefix = getEnv("LIBGIT2_PREFIX")
    if prefix.len > 0:
      switch("define", "knitLibgit2")
      switch("passC", "-I" & prefix & "/include")
      switch("passL", "-L" & prefix & "/lib")
      if defined(knitLibgit2Static):
        switch("passL", "-Wl,-Bstatic -lgit2 -lssh2 -lmbedtls -lmbedx509 -lmbedcrypto -lz -lpcre2-8 -Wl,-Bdynamic -lwinhttp -lcrypt32 -lrpcrt4 -lole32 -lws2_32 -lsecur32 -lbcrypt")
      else:
        switch("passL", "-lgit2")
    elif defined(knitLibgit2Static):
      switch("define", "knitLibgit2")
      switch("passL", "-lgit2 -lssh2 -lmbedtls -lmbedx509 -lmbedcrypto -lz -lpcre2-8 -lwinhttp -lcrypt32 -lrpcrt4 -lole32 -lws2_32 -lsecur32 -lbcrypt")
  else:
    let (cflags, ccode) = gorgeEx("pkg-config --cflags libgit2")
    let (libs, lcode) = gorgeEx("pkg-config --libs libgit2")
    if ccode == 0 and lcode == 0 and libs.strip().len > 0:
      switch("define", "knitLibgit2")
      for flag in cflags.strip().splitWhitespace():
        if flag.len > 0:
          switch("passC", flag)
      for flag in libs.strip().splitWhitespace():
        if flag.len > 0:
          switch("passL", flag)
