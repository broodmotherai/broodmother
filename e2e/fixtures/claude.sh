#!/bin/sh
# Claude Code's shape without Claude: the errand tool reads stream-json off stdout and wants a
# result event. Enough for a test to see an errand run and come back; not enough to do work.
echo '{"type":"result","is_error":false,"result":"nothing was done — this is the test stand-in"}'
