#!/bin/bash -e
# Runs inside the image. Starts the bootstrap on every boot until it has succeeded once.
systemctl enable the-max-mix-bootstrap.service
