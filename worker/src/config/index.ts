import devConfig from "./dev"
import prodConfig from "./prod"
import dockerConfig from "./docker"

const config = (process.env.NODE_ENV === undefined || process.env.NODE_ENV === 'dev') ? devConfig : process.env.NODE_ENV === 'docker' ? dockerConfig : prodConfig

export default config