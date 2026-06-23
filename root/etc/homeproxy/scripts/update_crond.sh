#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
#
# Copyright (C) 2023 ImmortalWrt.org

SCRIPTS_DIR="/etc/homeproxy/scripts"

# Region rule-sets (geosite/geoip .srs) are remote sing-box rule_sets — the core downloads
# and refreshes them itself (update_interval). No firewall list files to cron-update anymore.

"$SCRIPTS_DIR"/update_subscriptions.uc
