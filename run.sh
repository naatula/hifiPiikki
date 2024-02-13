#!/data/data/com.termux/files/usr/bin/bash
dir=$(realpath $(dirname $0))
cd $dir
echo $dir
source ./venv/bin/activate
gunicorn --bind 0.0.0.0:8000 hifiPiikki.wsgi