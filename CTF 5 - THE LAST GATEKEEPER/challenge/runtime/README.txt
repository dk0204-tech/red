CTF 5 — THE LAST GATEKEEPER: SPLIT SEAL — local runtime (Windows hosts)

Built by scripts/fetch-runtime.mjs. Contents:
  qemu/     QEMU system emulator (MSYS2 ucrt64 build — extracted, no installer/admin)
  kernel/   Alpine linux-virt kernel + static busybox + initramfs.cpio.gz
            (initramfs embeds the unmodified challenge/gatekeeper ELF)
  .ready.json  build marker

Sources: repo.msys2.org (QEMU, GPL-2.0+), dl-cdn.alpinelinux.org (kernel, GPL-2.0),
busybox.net (busybox, GPL-2.0), deb.debian.org (glibc, LGPL-2.1+).

Linux and Docker deployments do not use this directory — they run the ELF natively.
Delete scripts/.cache/ to reclaim download space.