"""Shared Postgres connection helper, used by both the maintenance
coordinator graph and the iCal sync."""

import os

import psycopg
from psycopg.rows import dict_row

DATABASE_URL = os.environ["DATABASE_URL"]


def db():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row, autocommit=True)
