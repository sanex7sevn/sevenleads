@echo off
git --git-dir="%~dp0.version-control" --work-tree="%~dp0." %*
