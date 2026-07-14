"""Auto-imported by Python at startup (site module).

Cap onnxruntime to an explicit thread count. Without this, ORT applies
default thread affinity, and pthread_setaffinity_np fails with EINVAL in
containers whose cpuset doesn't include the pinned cores (LXC/Proxmox
hosts). Setting the counts explicitly makes ORT skip affinity entirely —
and keeps Piper polite on a box shared with app builds.
"""

import os

import onnxruntime as ort

_OrigSession = ort.InferenceSession


class _ExplicitThreadSession(_OrigSession):
    def __init__(self, *args, sess_options=None, **kwargs):
        if sess_options is None:
            sess_options = ort.SessionOptions()
        sess_options.intra_op_num_threads = int(os.environ.get("ORT_INTRA_THREADS", "1"))
        sess_options.inter_op_num_threads = 1
        super().__init__(*args, sess_options=sess_options, **kwargs)


ort.InferenceSession = _ExplicitThreadSession
