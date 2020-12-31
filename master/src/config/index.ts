import devConfig from "./dev"
import prodConfig from "./prod"


const config = (process.env.NODE_ENV === "dev" || process.env.NODE_ENV === undefined) ? devConfig : prodConfig;

export default config