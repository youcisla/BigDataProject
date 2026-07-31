# Spark image with the pipeline's Python dependencies baked in.
#
# The stock apache/spark image ships no third-party Python packages, so the
# Silver job's MinHash/LSH dedup (datasketch) and the Gold job's VADER
# sentiment scoring had to be pip-installed into a running container by hand —
# and were lost on every `docker compose down`.
FROM apache/spark:3.5.1

USER root

RUN set -eux;     python3 -m pip install --no-cache-dir         datasketch==1.6.4         vaderSentiment==3.3.2

# The Postgres JDBC driver is vendored rather than downloaded at build time:
# spark-submit --packages resolves from Maven at *run* time, which fails behind
# an SSL-inspecting proxy or offline. Refresh it with `make jdbc-jar`.
COPY postgresql-42.7.3.jar /opt/spark/jars/postgresql-42.7.3.jar

USER spark
