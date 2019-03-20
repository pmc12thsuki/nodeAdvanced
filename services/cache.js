/* eslint-disable func-names */
const mongoose = require('mongoose');
const redis = require('redis');
const util = require('util');

const redisURI = 'redis://127.0.0.1:6379';
const client = redis.createClient(redisURI);
client.hget = util.promisify(client.hget); // 把使用 callback 的 function 變成 promise

const { exec } = mongoose.Query.prototype;
// exec is a reference to the original exec function
// 原本的 mongoose.Query.prototype.exec 是一個地址，指向原始的 exec function 的位置
// 現在將變數 exec 也指向這個原始 exec function 的位置
// 所以現在有兩個 pointer 指向同一個 function

mongoose.Query.prototype.cache = function (options = {}) {
  this.useCache = true;
  this.hashKey = JSON.stringify(options.key || ''); // 可以指定 set 進 redis 時要用什麼當 key
  return this;
};


mongoose.Query.prototype.exec = async function () {
  // 複寫 mongoose.Query.prototype.exec 指向的位置，將他指向一個新的 function、而變數 exec 仍然指向原始 exec function 的位置
  // 使用 function 而不是 arrow function，因為我們需要使用到 this
  // function 中的 this 會指向呼叫這個 function 的 Query

  // console.log(this.mongooseCollection.name); // 列出這個 query 是對哪個 collection 下的
  // console.log(this.getQuery()); // 列出 query 的細節


  // 檢查該 query 有沒有要用 cache，若沒有就直接去 mongoDB 中查找
  if (!this.useCache) {
    return exec.apply(this, arguments);
  }

  // 組合出 redis key - 使用 getQuery() + Collection name 組合
  // 不能直接把 collection name 加進 getQuery 中，因為這樣會真正影響到這個 query 中的參數
  // 所以要把 getQuery 的結果複製一份起來再修改
  // 把 this.getQUery() 的結果跟 {collection: value} 都 assign 給一個新的 object， Object.assign 會把第二個參數起的值都複製進第一個參數中
  const key = JSON.stringify(Object.assign({}, this.getQuery(), {
    collection: this.mongooseCollection.name,
  }));

  // 先檢查  redis 中有沒有這個 query 的結果
  const cacheValue = await client.hget(this.hashKey, key); // 取得 hashkey 中的 key 中的值 {hashKey: {key: value}}

  // 有的話，就直接 return
  if (cacheValue) {
    // 從 redis 拿出來(再 parse)的是 JSON，而不是 mongoose document type，但 exec 應該要返回 mongoose document type

    const result = JSON.parse(cacheValue);

    // 檢查 result 是不是 array of object，是個話要將 array 中的每個 object 轉換成 document。否則 result 就是 JSON object，直接轉換成 document
    return Array.isArray(result)
      ? result.map((d) => new this.model(d)) // 回傳 array of mongoose documents
      : new this.model(result); // 回傳一個 mongoose document

    // new this.model(json_obj)  等同於 new Blog({
    //   title: 'Hi',
    //   content: 'There'
    // })
  }

  // 沒有的話，向 mongo DB query，並且把結果 cache 進 redis 中
  // 呼叫原始 exec function，並將 this 綁定在現在的 Query 上
  // arguments 是所有被傳進這個 function 的參數
  const result = await exec.apply(this, arguments);

  // mongoose 回傳的 result 是一個 mongoose document 而不是一個 JSON object，這個 mongoose document 中還有更多的函數可以使用
  // 要把 result 存進 redis 之前，要先 stringify
  client.hset(this.hashKey, key, JSON.stringify(result));
  return result;
};


module.exports = {
  // 刪除特定的 cache
  async clearHash(hashKey) {
    await client.del(JSON.stringify(hashKey));
  },
};
