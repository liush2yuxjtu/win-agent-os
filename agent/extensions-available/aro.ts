import aro from "aro-extension";

export default aro({
  baseUrl: process.env.ARO_BACKEND_URL ?? "http://127.0.0.1:8000",
  token: process.env.ARO_BACKEND_TOKEN,
});
